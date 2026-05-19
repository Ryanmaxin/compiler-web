import express from "express"
import os from "node:os"
import path from "node:path"
import { execFile } from "node:child_process"
import { promises as fs } from "node:fs"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const frontendRoot = path.resolve(__dirname, "..")
const compilerRoot = path.resolve(frontendRoot, "../joos1w-compiler")
const compilerOutputDir = path.join(compilerRoot, "output")
const debugOutputDir = path.join(compilerRoot, "visualizations", "debug")
const stdlibRoot = path.join(compilerRoot, "std2.0", "java")
const runtimeAssembly = path.join(compilerRoot, "std2.0", "runtime.s")
const distDir = path.join(frontendRoot, "dist")
const port = Number(process.env.PORT ?? 3001)

const debugArtifacts = [
  {
    fileName: "01_frontend.dot",
    artifactId: "frontend-tree",
    stageId: "frontend",
    label: "Parsed AST",
    description: "The initial AST after lexing, parsing, and weeding.",
  },
  {
    fileName: "02_resolved.dot",
    artifactId: "resolved-tree",
    stageId: "resolution",
    label: "Environment",
    description:
      "The resolver has built the visible symbol environment: declarations, imports, and type names are all in scope, even though use-sites are not fully rebound yet.",
  },
  {
    fileName: "03_hierarchy.dot",
    artifactId: "hierarchy-tree",
    stageId: "hierarchy",
    label: "Class Hierarchy",
    description: "Inheritance and hierarchy validation state produced by the compiler.",
  },
  {
    fileName: "04_disambiguated.dot",
    artifactId: "disambiguated-tree",
    stageId: "disambiguation",
    label: "Bindings",
    description:
      "Ambiguous names have now been rebound to specific declarations. Variable and type uses usually gain concrete SIDs here, while some call targets are finalized during type checking.",
  },
  {
    fileName: "05_typechecked.dot",
    artifactId: "typechecked-tree",
    stageId: "typecheck",
    label: "Semantics",
    description:
      "The compiler has assigned expression types and resolved concrete call targets. When available, reachability is folded into the same semantic view.",
  },
  {
    fileName: "06_pre_backend.dot",
    artifactId: "typechecked-tree",
    stageId: "typecheck",
    hidden: true,
  },
]

const pipelineBlueprint = [
  {
    id: "source",
    label: "Source",
    subtitle: "workspace",
    artifactId: "source-summary",
  },
  {
    id: "lexing",
    label: "Lexing",
    subtitle: "scanner",
    artifactId: "tokens",
  },
  {
    id: "frontend",
    label: "AST",
    subtitle: "parse + weed",
    artifactId: "frontend-tree",
  },
  {
    id: "resolution",
    label: "Environment",
    subtitle: "symbol table",
    artifactId: "resolved-tree",
  },
  {
    id: "hierarchy",
    label: "Hierarchy",
    subtitle: "classes",
    artifactId: "hierarchy-tree",
  },
  {
    id: "disambiguation",
    label: "Bindings",
    subtitle: "resolved uses",
    artifactId: "disambiguated-tree",
  },
  {
    id: "typecheck",
    label: "Semantics",
    subtitle: "types + calls",
    artifactId: "typechecked-tree",
  },
  {
    id: "codegen",
    label: "Codegen",
    subtitle: "assembly",
    artifactId: "assembly",
  },
  {
    id: "output",
    label: "Output",
    subtitle: "runtime",
    artifactId: "output",
  },
]

const app = express()
app.use(express.json({ limit: "1mb" }))

let compileQueue = Promise.resolve()

function queueCompilation(task) {
  const next = compileQueue.then(task, task)
  compileQueue = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

function compilerEnv() {
  return {
    ...process.env,
    JOOS_STDLIB: stdlibRoot,
  }
}

function compilerCommandArgs(args) {
  return ["exec", "joosc", "--", ...args]
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        maxBuffer: 10 * 1024 * 1024,
        ...options,
      },
      (error, stdout, stderr) => {
        if (error) {
          resolve({
            code: typeof error.code === "number" ? error.code : 1,
            stdout,
            stderr,
          })
          return
        }

        resolve({ code: 0, stdout, stderr })
      },
    )
  })
}

async function ensureCleanDirectory(directory) {
  await fs.rm(directory, { force: true, recursive: true })
  await fs.mkdir(directory, { recursive: true })
}

async function listAssemblyFiles(directory) {
  const entries = await fs.readdir(directory)
  return entries.filter((entry) => entry.endsWith(".s")).sort()
}

async function copyAssemblyFiles(sourceDir, destinationDir) {
  const files = await listAssemblyFiles(sourceDir)
  await Promise.all(
    files.map((file) =>
      fs.copyFile(path.join(sourceDir, file), path.join(destinationDir, file)),
    ),
  )
}

function normalizeFileName(fileName) {
  const trimmed = (fileName || "").trim()
  if (!trimmed) {
    return "Main.java"
  }

  const basename = path.basename(trimmed)
  return basename.endsWith(".java") ? basename : `${basename}.java`
}

function normalizeFiles(files) {
  return files.map((file, index) => ({
    name: normalizeFileName(file?.name || `Main${index + 1}.java`),
    source: typeof file?.source === "string" ? file.source : "",
  }))
}

function validateFiles(files) {
  if (files.length === 0) {
    return "At least one file is required."
  }

  const seen = new Set()

  for (const file of files) {
    if (!file.source.trim()) {
      return `${file.name} is empty.`
    }

    if (seen.has(file.name)) {
      return `Duplicate file name: ${file.name}`
    }

    seen.add(file.name)
  }

  return null
}

function getOrderedAssemblyFiles(files, normalizedFileNames, primaryFileName) {
  const userAssemblyNames = normalizedFileNames.map((fileName) =>
    fileName.replace(/\.java$/, ".s"),
  )
  const existingUserFiles = userAssemblyNames.filter((fileName) =>
    files.includes(fileName),
  )
  const primaryAssembly = primaryFileName
    ? normalizeFileName(primaryFileName).replace(/\.java$/, ".s")
    : null

  const orderedUserFiles = primaryAssembly
    ? [
        ...existingUserFiles.filter((fileName) => fileName === primaryAssembly),
        ...existingUserFiles.filter((fileName) => fileName !== primaryAssembly),
      ]
    : existingUserFiles

  const supplementalFiles = files.filter(
    (fileName) =>
      fileName !== "_start.s" &&
      !fileName.startsWith("java.") &&
      !orderedUserFiles.includes(fileName),
  )

  return [...orderedUserFiles, ...supplementalFiles, "_start.s"].filter(
    (fileName, index, array) =>
      files.includes(fileName) && array.indexOf(fileName) === index,
  )
}

async function readCombinedAssembly(outputDir, normalizedFileNames, primaryFileName) {
  const files = await listAssemblyFiles(outputDir)
  const ordered = getOrderedAssemblyFiles(
    files,
    normalizedFileNames,
    primaryFileName,
  )

  if (ordered.length === 0) {
    return ""
  }

  const chunks = await Promise.all(
    ordered.map(async (file) => {
      const content = await fs.readFile(path.join(outputDir, file), "utf8")
      return `; ===== ${file} =====\n${content.trimEnd()}`
    }),
  )

  return `${chunks.join("\n\n")}\n`
}

function categorizeToken(kind) {
  const keywordKinds = new Set([
    "ABSTRACT",
    "BOOLEAN",
    "BYTE",
    "CHAR",
    "CLASS",
    "ELSE",
    "EXTENDS",
    "FALSE",
    "FINAL",
    "FOR",
    "IF",
    "IMPLEMENTS",
    "IMPORT",
    "INSTANCEOF",
    "INT",
    "INTERFACE",
    "NATIVE",
    "NEW",
    "NULL",
    "PACKAGE",
    "PRIVATE",
    "PROTECTED",
    "PUBLIC",
    "RETURN",
    "SHORT",
    "STATIC",
    "SUPER",
    "THIS",
    "TRUE",
    "VOID",
    "WHILE",
  ])

  if (kind === "ID") {
    return "identifier"
  }

  if (
    kind.endsWith("_LITERAL") ||
    kind === "CHARACTER" ||
    kind === "STRING_LITERAL"
  ) {
    return "literal"
  }

  if (keywordKinds.has(kind)) {
    return "keyword"
  }

  if (
    kind === "LPAREN" ||
    kind === "RPAREN" ||
    kind === "LBRACE" ||
    kind === "RBRACE" ||
    kind === "LBRACKET" ||
    kind === "RBRACKET" ||
    kind === "PLUS" ||
    kind === "MINUS" ||
    kind === "STAR" ||
    kind === "SLASH" ||
    kind === "PERCENT" ||
    kind === "SEMICOLON" ||
    kind === "DOT" ||
    kind === "COMMA" ||
    kind === "ASSIGN" ||
    kind === "EQUALS" ||
    kind === "NOT_EQUALS" ||
    kind === "LT" ||
    kind === "LEQ" ||
    kind === "GT" ||
    kind === "GEQ" ||
    kind === "BANG" ||
    kind === "AND" ||
    kind === "OR"
  ) {
    return "symbol"
  }

  return "other"
}

function parseTokenLine(line) {
  const trimmed = line.trim()
  if (!trimmed) {
    return null
  }

  const match = trimmed.match(/^([A-Z_]+)\((.*)\)$/)
  const kind = match ? match[1] : trimmed
  const lexeme = match ? match[2] : null

  return {
    raw: trimmed,
    kind,
    lexeme,
    category: categorizeToken(kind),
  }
}

async function collectTokens(normalizedFiles, tempSourceDir) {
  const tokensByFile = {}

  for (const file of normalizedFiles) {
    const result = await runCommand(
      "dune",
      ["exec", "scanner", "--", path.join(tempSourceDir, file.name)],
      {
        cwd: compilerRoot,
        env: compilerEnv(),
      },
    )

    if (result.code !== 0) {
      return {
        ok: false,
        output:
          result.stderr || result.stdout || "The scanner failed without output.",
        tokensByFile,
      }
    }

    tokensByFile[file.name] = result.stdout
      .split(/\r?\n/)
      .map(parseTokenLine)
      .filter(Boolean)
  }

  return { ok: true, tokensByFile }
}

function unescapeDotLabel(label) {
  return label
    .replace(/\\"/g, '"')
    .replace(/\\n/g, " / ")
    .replace(/\\\\/g, "\\")
}

function buildValueSidTypeMap(content) {
  const sidToType = new Map()

  for (const line of content.split(/\r?\n/)) {
    const labelMatch = line.match(/label="((?:\\.|[^"])*)"/)
    if (!labelMatch) {
      continue
    }

    const label = unescapeDotLabel(labelMatch[1])
    const match = label.match(/:\s([^[]+?)\s\[sid=(ValueSid\(\d+\))\]/)
    if (match) {
      sidToType.set(match[2], match[1].trim())
    }
  }

  return sidToType
}

function enrichTypedDot(content) {
  const sidToType = buildValueSidTypeMap(content)

  return content.replace(/label="((?:\\.|[^"])*)"/g, (fullMatch, escapedLabel) => {
    const label = unescapeDotLabel(escapedLabel)
    if (label.includes("[type=")) {
      return fullMatch
    }

    const sidMatch = label.match(/\[(sid=ValueSid\(\d+\))\]/)
    if (!sidMatch) {
      return fullMatch
    }

    const typeName = sidToType.get(sidMatch[1].replace(/^sid=/, ""))
    if (!typeName) {
      return fullMatch
    }

    const enriched = label.replace(
      /\[(sid=ValueSid\(\d+\))\]/,
      `[type=${typeName}] [$1]`,
    )

    return `label="${enriched
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/ \/ /g, "\\n")}"`
  })
}

function collectUniqueRows(rows) {
  const seen = new Set()
  return rows.filter((row) => {
    const key = row.join("\u0001")
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function extractInsightTables(stageId, content) {
  const labels = content
    .split(/\r?\n/)
    .map((line) => line.match(/label="((?:\\.|[^"])*)"/)?.[1] ?? null)
    .filter(Boolean)
    .map((label) => unescapeDotLabel(label))

  if (stageId === "resolution") {
    const rows = collectUniqueRows(
      labels.flatMap((label) => {
        const symbolMatch = label.match(
          /^(.+?)\s\[(sid=(?:TypeSid|ValueSid)\(\d+\))\]$/,
        )
        if (!symbolMatch) {
          return []
        }

        const sid = symbolMatch[2].replace(/^sid=/, "")
        let kind = "symbol"
        if (label.startsWith("Class ")) {
          kind = "class"
        } else if (label.startsWith("LocalVarDecl ")) {
          kind = "local"
        } else if (label.startsWith("FieldDecl ")) {
          kind = "field"
        } else if (label.startsWith("Param ")) {
          kind = "parameter"
        } else if (label.startsWith("Method ")) {
          kind = "method"
        }

        return [[sid, kind, symbolMatch[1]]]
      }),
    )

    return rows.length > 0
      ? [
          {
            id: "resolution-sids",
            title: "SID Mappings",
            description:
              "Declarations introduced during environment building. Use-sites typically stay unresolved until disambiguation.",
            columns: ["SID", "Kind", "Binding"],
            rows,
          },
        ]
      : []
  }

  if (stageId === "disambiguation") {
    const rows = collectUniqueRows(
      labels.flatMap((label) => {
        const useMatch = label.match(
          /^(.+?)\s\[fqn=([^\]]+)\]\s\[(sid=ValueSid\(\d+\))\]$/,
        )
        if (!useMatch) {
          return []
        }

        const sid = useMatch[3].replace(/^sid=/, "")
        const nodeKind = useMatch[1].split(" ")[0]
        return [[sid, useMatch[2], nodeKind, useMatch[1]]]
      }),
    )

    return rows.length > 0
      ? [
          {
            id: "disambiguation-bindings",
            title: "Bound Use-Sites",
            description:
              "Expression occurrences that gained concrete symbol bindings during disambiguation.",
            columns: ["SID", "FQN", "Node", "Label"],
            rows,
          },
        ]
      : []
  }

  if (stageId === "typecheck") {
    const rows = collectUniqueRows(
      labels.flatMap((label) => {
        const typedMatch = label.match(
          /^(.+?)\s\[fqn=([^\]]+)\]\s\[type=([^\]]+)\]\s\[(sid=ValueSid\(\d+\))\]$/,
        )
        if (typedMatch) {
          return [[
            typedMatch[4].replace(/^sid=/, ""),
            typedMatch[3],
            typedMatch[2],
            typedMatch[1],
          ]]
        }

        const declMatch = label.match(
          /^(.+?)\s:\s([^[]+?)\s\[sid=(ValueSid\(\d+\))\]$/,
        )
        if (declMatch) {
          return [[declMatch[3], declMatch[2].trim(), "-", declMatch[1]]]
        }

        return []
      }),
    )

    return rows.length > 0
      ? [
          {
            id: "typecheck-types",
            title: "Type Mappings",
            description:
              "Best-effort type table derived from the typed declarations and enriched typed use-sites in the compiler debug artifact.",
            columns: ["SID", "Type", "FQN", "Label"],
            rows,
          },
        ]
      : []
  }

  return []
}

function parseDotTree(content) {
  const nodes = new Map()
  const childrenById = new Map()
  const childIds = new Set()

  for (const line of content.split(/\r?\n/)) {
    const nodeMatch = line.match(/^\s*(n\d+)\s+\[label="((?:\\.|[^"])*)"/)
    if (nodeMatch) {
      nodes.set(nodeMatch[1], {
        id: nodeMatch[1],
        label: unescapeDotLabel(nodeMatch[2]),
      })
      continue
    }

    const edgeMatch = line.match(/^\s*(n\d+)\s*->\s*(n\d+);/)
    if (edgeMatch) {
      const parentId = edgeMatch[1]
      const childId = edgeMatch[2]
      const currentChildren = childrenById.get(parentId) ?? []
      currentChildren.push(childId)
      childrenById.set(parentId, currentChildren)
      childIds.add(childId)
    }
  }

  if (nodes.size === 0) {
    return null
  }

  const rootId =
    (nodes.has("n0") && "n0") ||
    [...nodes.keys()].find((nodeId) => !childIds.has(nodeId)) ||
    [...nodes.keys()][0]

  function buildTree(nodeId, seen) {
    if (seen.has(nodeId)) {
      return {
        id: `${nodeId}-cycle`,
        label: `${nodes.get(nodeId)?.label ?? nodeId} (cycle)`,
        children: [],
      }
    }

    const node = nodes.get(nodeId)
    if (!node) {
      return {
        id: nodeId,
        label: nodeId,
        children: [],
      }
    }

    const nextSeen = new Set(seen)
    nextSeen.add(nodeId)

    return {
      id: node.id,
      label: node.label,
      children: (childrenById.get(nodeId) ?? []).map((childId) =>
        buildTree(childId, nextSeen),
      ),
    }
  }

  return buildTree(rootId, new Set())
}

async function collectDebugArtifacts(normalizedFilePaths) {
  await ensureCleanDirectory(debugOutputDir)

  const debugResult = await runCommand(
    "dune",
    compilerCommandArgs(["--debug", "@stdlib", ...normalizedFilePaths]),
    {
      cwd: compilerRoot,
      env: compilerEnv(),
    },
  )

  const artifacts = []
  const completedStageIds = new Set()

  for (const config of debugArtifacts) {
    const artifactPath = path.join(debugOutputDir, config.fileName)
    const content = await fs.readFile(artifactPath, "utf8").catch(() => null)
    const svgPath = artifactPath.replace(/\.dot$/, ".svg")
    const svg = await fs.readFile(svgPath, "utf8").catch(() => null)
    const insightsPath = artifactPath.replace(/\.dot$/, ".insights.json")
    const insightsPayload = await fs
      .readFile(insightsPath, "utf8")
      .then((raw) => JSON.parse(raw))
      .catch(() => null)

    if (!content) {
      continue
    }

    const enrichedContent =
      config.stageId === "typecheck" ? enrichTypedDot(content) : content

    completedStageIds.add(config.stageId)
    if (config.hidden) {
      continue
    }

    const insights =
      Array.isArray(insightsPayload?.tables) && insightsPayload.tables.length > 0
        ? insightsPayload.tables
        : extractInsightTables(config.stageId, enrichedContent)

    artifacts.push({
      id: config.artifactId,
      label: config.label,
      description: config.description,
      kind: "tree",
      tree: parseDotTree(enrichedContent),
      text: enrichedContent,
      dot: enrichedContent,
      svg: svg ?? undefined,
      insights,
    })
  }

  return { debugResult, artifacts, completedStageIds }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function inferDiagnosticLocation(message, normalizedFiles) {
  const quotedMatch = message.match(/'([^']+)'/)
  if (!quotedMatch) {
    return {}
  }

  const needle = quotedMatch[1]
  const wordPattern = new RegExp(`\\b${escapeRegex(needle)}\\b`)

  for (const file of normalizedFiles) {
    const lines = file.source.split("\n")

    for (let index = 0; index < lines.length; index += 1) {
      const columnIndex = lines[index].search(wordPattern)
      if (columnIndex !== -1) {
        return {
          fileName: file.name,
          line: index + 1,
          column: columnIndex + 1,
        }
      }
    }
  }

  return {}
}

function parseCompilerDiagnostic(rawOutput, fallbackStage, normalizedFiles) {
  const trimmed = rawOutput.trim()
  if (!trimmed) {
    return []
  }

  const errorLine =
    trimmed
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .findLast((line) => line.startsWith("ERROR:")) ?? trimmed
  const match = errorLine.match(
    /^ERROR:\s+Joos_types\.Exceptions\.([A-Z_]+)\("([\s\S]*)"\)$/,
  )

  if (!match) {
    return [
      {
        severity: "error",
        stage: fallbackStage,
        title: "Compiler Error",
        message: errorLine,
      },
    ]
  }

  const errorKind = match[1]
  const message = match[2]
  const locations = inferDiagnosticLocation(message, normalizedFiles)
  const title = errorKind
    .toLowerCase()
    .split("_")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ")

  return [
    {
      severity: "error",
      stage: fallbackStage,
      title,
      message,
      ...locations,
    },
  ]
}

function buildSourceSummary(normalizedFiles, primaryFileName) {
  const lines = [
    `Primary file: ${normalizeFileName(primaryFileName ?? normalizedFiles[0]?.name ?? "Main.java")}`,
    `Workspace files: ${normalizedFiles.length}`,
    "",
  ]

  for (const file of normalizedFiles) {
    const lineCount = file.source.split("\n").length
    lines.push(`- ${file.name} (${lineCount} lines)`)
  }

  return lines.join("\n")
}

function buildPipeline({
  completedStageIds,
  failedStageId,
  compileOk,
  outputOk,
  diagnostics,
}) {
  const diagnosticSummary =
    diagnostics[0]?.message ?? "Stage completed successfully."
  let hasReachedFailure = false

  return pipelineBlueprint.map((stage) => {
    let status = "pending"
    let detail = undefined

    if (completedStageIds.has(stage.id)) {
      status = "complete"
      detail = "Completed"
    } else if (!hasReachedFailure && failedStageId === stage.id) {
      status = "failed"
      detail = diagnosticSummary
      hasReachedFailure = true
    } else if (stage.id === "codegen" && compileOk) {
      status = "complete"
      detail = "Assembly emitted"
    } else if (stage.id === "output" && outputOk) {
      status = "complete"
      detail = "Program executed"
    } else if (hasReachedFailure) {
      status = "pending"
      detail = "Not reached"
    } else {
      status = "pending"
      detail = "Waiting"
    }

    return {
      ...stage,
      status,
      detail,
    }
  })
}

async function assembleAndRun(tempBuildDir) {
  const assemblyFiles = await listAssemblyFiles(tempBuildDir)

  if (assemblyFiles.length === 0) {
    return {
      ok: false,
      stage: "codegen",
      message: "Compiler finished without producing any assembly files.",
    }
  }

  for (const file of assemblyFiles) {
    const source = path.join(tempBuildDir, file)
    const object = path.join(tempBuildDir, file.replace(/\.s$/, ".o"))
    const nasmResult = await runCommand("/usr/bin/nasm", [
      "-O1",
      "-f",
      "elf",
      "-g",
      "-F",
      "dwarf",
      "-o",
      object,
      source,
    ])

    if (nasmResult.code !== 0) {
      return {
        ok: false,
        stage: "codegen",
        message: nasmResult.stderr || nasmResult.stdout || `nasm failed for ${file}`,
      }
    }
  }

  const runtimeObject = path.join(tempBuildDir, "runtime.o")
  const runtimeAssemble = await runCommand("/usr/bin/nasm", [
    "-O1",
    "-f",
    "elf",
    "-g",
    "-F",
    "dwarf",
    "-o",
    runtimeObject,
    runtimeAssembly,
  ])

  if (runtimeAssemble.code !== 0) {
    return {
      ok: false,
      stage: "codegen",
      message:
        runtimeAssemble.stderr ||
        runtimeAssemble.stdout ||
        "nasm failed for runtime.s",
    }
  }

  const objectFiles = (await fs.readdir(tempBuildDir))
    .filter((entry) => entry.endsWith(".o"))
    .sort()
    .map((entry) => path.join(tempBuildDir, entry))

  const executablePath = path.join(tempBuildDir, "main")
  const linkResult = await runCommand("ld", [
    "-melf_i386",
    "-o",
    executablePath,
    ...objectFiles,
  ])

  if (linkResult.code !== 0) {
    return {
      ok: false,
      stage: "codegen",
      message: linkResult.stderr || linkResult.stdout || "ld failed",
    }
  }

  const runResult = await runCommand(executablePath, [], {
    cwd: tempBuildDir,
  })

  return {
    ok: true,
    output: runResult.stdout,
    runtimeError: runResult.stderr,
    exitCode: runResult.code,
  }
}

async function compileProgram(files, primaryFileName) {
  const normalizedFiles = normalizeFiles(files)
  const normalizedFileNames = normalizedFiles.map((file) => file.name)
  const tempSourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "joos-source-"))
  const tempBuildDir = await fs.mkdtemp(path.join(os.tmpdir(), "joos-build-"))
  const startedAt = Date.now()

  try {
    await Promise.all(
      normalizedFiles.map((file) =>
        fs.writeFile(path.join(tempSourceDir, file.name), file.source, "utf8"),
      ),
    )

    const normalizedFilePaths = normalizedFileNames.map((fileName) =>
      path.join(tempSourceDir, fileName),
    )

    const sourceArtifact = {
      id: "source-summary",
      label: "Source Workspace",
      description: "The current flat set of Java files sent to the compiler.",
      kind: "text",
      text: buildSourceSummary(normalizedFiles, primaryFileName),
    }

    const tokenResult = await collectTokens(normalizedFiles, tempSourceDir)
    if (!tokenResult.ok) {
      const diagnostics = parseCompilerDiagnostic(
        tokenResult.output,
        "lexing",
        normalizedFiles,
      )
      const pipeline = buildPipeline({
        completedStageIds: new Set(["source"]),
        failedStageId: "lexing",
        compileOk: false,
        outputOk: false,
        diagnostics,
      })

      return {
        ok: false,
        stage: "lexing",
        output: tokenResult.output,
        assembly: "",
        pipeline,
        diagnostics,
        artifacts: [sourceArtifact],
        tokensByFile: tokenResult.tokensByFile,
      }
    }

    await ensureCleanDirectory(compilerOutputDir)

    const debugArtifactsResult = await collectDebugArtifacts(normalizedFilePaths)

    const compileResult = await runCommand(
      "dune",
      compilerCommandArgs(["--a5", "@stdlib", ...normalizedFilePaths]),
      {
        cwd: compilerRoot,
        env: compilerEnv(),
      },
    )
    const compileMs = Date.now() - startedAt
    const assembly =
      compileResult.code === 0
        ? await readCombinedAssembly(
            compilerOutputDir,
            normalizedFileNames,
            primaryFileName,
          )
        : ""
    const completedStageIds = new Set(["source", "lexing"])

    for (const stageId of debugArtifactsResult.completedStageIds) {
      completedStageIds.add(stageId)
    }

    const artifacts = [
      sourceArtifact,
      ...debugArtifactsResult.artifacts,
      {
        id: "assembly",
        label: "Generated Assembly",
        description:
          "A display-only concatenation of the separate .s files emitted by joosc for this workspace. The runtime pipeline still assembles each file independently before linking them together.",
        kind: "text",
        text:
          assembly ||
          "Assembly becomes available once the compilation reaches code generation.",
      },
    ]

    if (compileResult.code !== 0) {
      const missingDebugStage = debugArtifacts.find(
        (config) => !debugArtifactsResult.completedStageIds.has(config.stageId),
      )
      const failedStageId = missingDebugStage?.stageId ?? "codegen"
      const diagnostics = parseCompilerDiagnostic(
        compileResult.stderr || compileResult.stdout,
        failedStageId,
        normalizedFiles,
      )
      const pipeline = buildPipeline({
        completedStageIds,
        failedStageId,
        compileOk: false,
        outputOk: false,
        diagnostics,
      })

      return {
        ok: false,
        stage: failedStageId,
        output:
          compileResult.stderr ||
          compileResult.stdout ||
          "Compilation failed without an error message.",
        assembly,
        compileMs,
        pipeline,
        diagnostics,
        artifacts,
        tokensByFile: tokenResult.tokensByFile,
      }
    }

    completedStageIds.add("codegen")
    await copyAssemblyFiles(compilerOutputDir, tempBuildDir)

    const runStartedAt = Date.now()
    const execution = await assembleAndRun(tempBuildDir)
    const runMs = Date.now() - runStartedAt

    const runtimeOutput = execution.ok
      ? execution.output
      : execution.message
    artifacts.push({
      id: "output",
      label: "Runtime Output",
      description: "The stdout and runtime status of the generated executable.",
      kind: "text",
      text:
        runtimeOutput ||
        execution.runtimeError ||
        "The compiled program did not print anything.",
    })

    if (!execution.ok) {
      const diagnostics = [
        {
          severity: "error",
          stage: execution.stage,
          title: "Runtime Pipeline Error",
          message: execution.message,
        },
      ]
      const pipeline = buildPipeline({
        completedStageIds,
        failedStageId: "output",
        compileOk: true,
        outputOk: false,
        diagnostics,
      })

      return {
        ok: false,
        stage: execution.stage,
        compileMs,
        runMs,
        output: execution.message,
        assembly,
        pipeline,
        diagnostics,
        artifacts,
        tokensByFile: tokenResult.tokensByFile,
      }
    }

    completedStageIds.add("output")
    const diagnostics = []
    const pipeline = buildPipeline({
      completedStageIds,
      failedStageId: null,
      compileOk: true,
      outputOk: true,
      diagnostics,
    })

    return {
      ok: true,
      stage: "output",
      compileMs,
      runMs,
      output: execution.output,
      runtimeError: execution.runtimeError,
      exitCode: execution.exitCode,
      assembly,
      pipeline,
      diagnostics,
      artifacts,
      tokensByFile: tokenResult.tokensByFile,
    }
  } finally {
    await fs.rm(tempSourceDir, { force: true, recursive: true })
    await fs.rm(tempBuildDir, { force: true, recursive: true })
  }
}

app.post("/api/run", async (req, res) => {
  const files = Array.isArray(req.body?.files) ? req.body.files : []
  const primaryFileName =
    typeof req.body?.primaryFileName === "string"
      ? req.body.primaryFileName
      : undefined
  const normalizedFiles = normalizeFiles(files)
  const validationError = validateFiles(normalizedFiles)

  if (validationError) {
    const diagnostics = [
      {
        severity: "error",
        stage: "validate",
        title: "Validation Error",
        message: validationError,
      },
    ]

    res.status(400).json({
      ok: false,
      stage: "validate",
      output: validationError,
      assembly: "",
      pipeline: buildPipeline({
        completedStageIds: new Set(),
        failedStageId: "source",
        compileOk: false,
        outputOk: false,
        diagnostics,
      }),
      diagnostics,
      artifacts: [
        {
          id: "source-summary",
          label: "Source Workspace",
          description: "The current flat set of Java files sent to the compiler.",
          kind: "text",
          text: buildSourceSummary(normalizedFiles, primaryFileName),
        },
      ],
      tokensByFile: {},
    })
    return
  }

  try {
    const result = await queueCompilation(() =>
      compileProgram(normalizedFiles, primaryFileName),
    )
    res.json(result)
  } catch (error) {
    res.status(500).json({
      ok: false,
      stage: "server",
      output:
        error instanceof Error ? error.message : "Unexpected server failure.",
      assembly: "",
      pipeline: buildPipeline({
        completedStageIds: new Set(),
        failedStageId: "source",
        compileOk: false,
        outputOk: false,
        diagnostics: [
          {
            severity: "error",
            stage: "server",
            title: "Server Error",
            message:
              error instanceof Error
                ? error.message
                : "Unexpected server failure.",
          },
        ],
      }),
      diagnostics: [
        {
          severity: "error",
          stage: "server",
          title: "Server Error",
          message:
            error instanceof Error
              ? error.message
              : "Unexpected server failure.",
        },
      ],
      artifacts: [],
      tokensByFile: {},
    })
  }
})

app.get("/api/health", (_req, res) => {
  res.json({ ok: true })
})

if (await fs
  .stat(distDir)
  .then((stats) => stats.isDirectory())
  .catch(() => false)) {
  app.use(express.static(distDir))
  app.get(/^(?!\/api\/).*/, (req, res, next) => {
    if (req.path.startsWith("/api/")) {
      next()
      return
    }

    res.sendFile(path.join(distDir, "index.html"))
  })
}

app.listen(port, () => {
  console.log(`joos frontend server running on http://127.0.0.1:${port}`)
})
