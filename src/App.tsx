import { useEffect, useMemo, useRef, useState } from "react"
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  FilePlus2,
  FolderKanban,
  Minus,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { compileSource } from "@/lib/compiler-adapter"
import type {
  CompilerArtifact,
  CompilerDiagnostic,
  CompilerPipelineStage,
  CompilerResult,
  CompilerToken,
  CompilerTreeNode,
  SampleProgram,
  SourceFile,
} from "@/lib/compiler-types"
import { samplePrograms } from "@/lib/demo-programs"
import { cn } from "@/lib/utils"

type InspectorTab = "inspector" | "diagnostics" | "architecture"

interface WorkspaceFile extends SourceFile {
  id: string
}

const TAB_STRING = "  "

const featureChecklist = [
  "Lexing and token inspection",
  "AST construction and weeding",
  "Environment construction",
  "Hierarchy validation",
  "Name binding",
  "Type checking and call resolution",
  "Assembly generation",
  "Native runtime execution",
]

const architectureSteps = [
  "React + TypeScript frontend with a flat file workspace.",
  "Small Express adapter that writes the current files to a temporary directory.",
  "Real `joosc` runs for debug stages, code generation, and native execution.",
  "Graphviz debug artifacts rendered as a tree view plus raw `.dot` and SVG popup inspection.",
]

function App() {
  const nextFileId = useRef(1)
  const initialFiles = createEmptyWorkspaceFiles(nextFileId)

  const [selectedSampleId, setSelectedSampleId] = useState(samplePrograms[0].id)
  const [files, setFiles] = useState<WorkspaceFile[]>(initialFiles)
  const [activeFileId, setActiveFileId] = useState(initialFiles[0].id)
  const [result, setResult] = useState<CompilerResult | null>(null)
  const [selectedArtifactId, setSelectedArtifactId] = useState("source-summary")
  const [activeInspectorTab, setActiveInspectorTab] =
    useState<InspectorTab>("architecture")
  const [isRunning, setIsRunning] = useState(false)
  const [graphArtifact, setGraphArtifact] = useState<CompilerArtifact | null>(null)
  const [graphView, setGraphView] = useState<"svg" | "dot">("svg")

  const activeFile = files.find((file) => file.id === activeFileId) ?? files[0]
  const selectedSample =
    samplePrograms.find((sample) => sample.id === selectedSampleId) ??
    samplePrograms[0]
  const selectedArtifact = getSelectedArtifact(result, selectedArtifactId)
  const activeFileTokens = result?.tokensByFile[activeFile?.name ?? ""] ?? []
  const diagnosticFileNames = new Set(
    (result?.diagnostics ?? [])
      .map((diagnostic) => diagnostic.fileName)
      .filter((value): value is string => Boolean(value)),
  )

  useEffect(() => {
    if (!result) {
      return
    }

    const failedStage = result.pipeline.find((stage) => stage.status === "failed")
    const defaultArtifactId = failedStage?.artifactId ?? "output"
    setSelectedArtifactId(defaultArtifactId)
    setActiveInspectorTab(failedStage ? "diagnostics" : "inspector")
  }, [result])

  const statusText = useMemo(() => {
    if (!result) {
      return "Empty workspace ready. Load a sample or edit the file, then compile to inspect each stage."
    }

    if (result.ok) {
      return `Compilation succeeded through runtime. compile ${result.compileMs ?? 0}ms, run ${result.runMs ?? 0}ms.`
    }

    return `Stopped during ${formatStageName(result.stage)}.`
  }, [result])

  async function handleCompile() {
    if (!activeFile) {
      return
    }

    setIsRunning(true)

    try {
      const nextResult = await compileSource({
        files: files.map((file) => ({
          name: file.name,
          source: file.source,
        })),
        primaryFileName: activeFile.name,
      })
      setResult(nextResult)
    } catch (error) {
      setResult({
        ok: false,
        stage: "client",
        output:
          error instanceof Error ? error.message : "Unexpected client error.",
        assembly: "",
        pipeline: [],
        diagnostics: [
          {
            severity: "error",
            stage: "client",
            title: "Client Error",
            message:
              error instanceof Error ? error.message : "Unexpected client error.",
          },
        ],
        artifacts: [],
        tokensByFile: {},
      })
    } finally {
      setIsRunning(false)
    }
  }

  function handleLoadSample() {
    const nextFiles = createWorkspaceFiles(selectedSample, nextFileId)
    setFiles(nextFiles)
    setActiveFileId(nextFiles[0].id)
    setResult(null)
    setSelectedArtifactId("source-summary")
    setActiveInspectorTab("architecture")
  }

  function handleResetWorkspace() {
    const nextFiles = createEmptyWorkspaceFiles(nextFileId)
    setFiles(nextFiles)
    setActiveFileId(nextFiles[0].id)
    setResult(null)
    setSelectedArtifactId("source-summary")
    setActiveInspectorTab("architecture")
  }

  function updateActiveFile(patch: Partial<SourceFile>) {
    if (!activeFile) {
      return
    }

    setFiles((currentFiles) =>
      currentFiles.map((file) =>
        file.id === activeFile.id ? { ...file, ...patch } : file,
      ),
    )
    setResult(null)
  }

  function handleAddFile() {
    const nextName = createUntitledFileName(files)
    const className = nextName.replace(/\.java$/, "")
    const nextFile = {
      id: `file-${nextFileId.current++}`,
      name: nextName,
      source: normalizeIndentation(
        `public class ${className} {\n  public ${className}() {}\n}\n`,
      ),
    }

    setFiles((currentFiles) => [...currentFiles, nextFile])
    setActiveFileId(nextFile.id)
    setResult(null)
  }

  function handleRemoveActiveFile() {
    if (!activeFile || files.length === 1) {
      return
    }

    const currentIndex = files.findIndex((file) => file.id === activeFile.id)
    const remainingFiles = files.filter((file) => file.id !== activeFile.id)
    const fallbackFile =
      remainingFiles[Math.max(0, currentIndex - 1)] ?? remainingFiles[0]

    setFiles(remainingFiles)
    setActiveFileId(fallbackFile.id)
    setResult(null)
  }

  function handleEditorKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!activeFile || event.key !== "Tab") {
      return
    }

    event.preventDefault()

    const textarea = event.currentTarget
    const selectionStart = textarea.selectionStart
    const selectionEnd = textarea.selectionEnd
    const value = activeFile.source

    if (!event.shiftKey && selectionStart === selectionEnd) {
      const nextValue =
        value.slice(0, selectionStart) + TAB_STRING + value.slice(selectionEnd)

      updateActiveFile({ source: nextValue })

      requestAnimationFrame(() => {
        textarea.selectionStart = selectionStart + TAB_STRING.length
        textarea.selectionEnd = selectionStart + TAB_STRING.length
      })
      return
    }

    const lineStart = value.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1
    const lineEndIndex = value.indexOf("\n", selectionEnd)
    const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex
    const selectedBlock = value.slice(lineStart, lineEnd)
    const lines = selectedBlock.split("\n")

    if (event.shiftKey) {
      const removedPerLine: number[] = lines.map((line) => {
        if (line.startsWith(TAB_STRING)) {
          return TAB_STRING.length
        }
        if (line.startsWith(" ") || line.startsWith("\t")) {
          return 1
        }
        return 0
      })
      const nextBlock = lines
        .map((line, index) => line.slice(removedPerLine[index]))
        .join("\n")
      const nextValue =
        value.slice(0, lineStart) + nextBlock + value.slice(lineEnd)
      const totalRemoved = removedPerLine.reduce<number>(
        (sum, count) => sum + count,
        0,
      )
      const nextSelectionStart = Math.max(
        lineStart,
        selectionStart - removedPerLine[0],
      )
      const nextSelectionEnd = Math.max(
        nextSelectionStart,
        selectionEnd - totalRemoved,
      )

      updateActiveFile({ source: nextValue })

      requestAnimationFrame(() => {
        textarea.selectionStart = nextSelectionStart
        textarea.selectionEnd = nextSelectionEnd
      })
      return
    }

    const nextBlock = lines.map((line) => `${TAB_STRING}${line}`).join("\n")
    const nextValue = value.slice(0, lineStart) + nextBlock + value.slice(lineEnd)
    const nextSelectionStart = selectionStart + TAB_STRING.length
    const nextSelectionEnd = selectionEnd + lines.length * TAB_STRING.length

    updateActiveFile({ source: nextValue })

    requestAnimationFrame(() => {
      textarea.selectionStart = nextSelectionStart
      textarea.selectionEnd = nextSelectionEnd
    })
  }

  return (
    <>
      <main className="min-h-screen bg-[radial-gradient(circle_at_top,#fef3c7_0%,#fff7ed_28%,#fff 60%)] p-4 sm:p-6">
        <div className="mx-auto flex max-w-[1700px] flex-col gap-4">
          <header className="rounded-[28px] border border-border/70 bg-white/90 p-5 shadow-panel backdrop-blur">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="max-w-3xl space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="bg-amber-500 text-white">Compiler Explorer</Badge>
                  <Badge variant="outline">Real joosc backend</Badge>
                </div>
                <h1 className="text-3xl font-semibold tracking-tight">
                  Joos compiler playground
                </h1>
                <p className="text-sm text-muted-foreground">
                  Edit a flat Java workspace on the left, then inspect tokens,
                  trees, Graphviz output, diagnostics, assembly, and runtime
                  output on the right.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={handleCompile}>
                  <Play className="h-4 w-4" />
                  {isRunning ? "Compiling..." : "Compile"}
                </Button>
                <Button onClick={handleResetWorkspace} variant="outline">
                  <RotateCcw className="h-4 w-4" />
                  Empty workspace
                </Button>
                <Button onClick={handleLoadSample} variant="outline">
                  <Sparkles className="h-4 w-4" />
                  Load sample
                </Button>
              </div>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
              <label className="flex flex-col gap-2 text-sm">
                <span className="font-medium">Curated sample</span>
                <select
                  className="h-11 rounded-full border border-input bg-background/70 px-4 text-sm"
                  onChange={(event) => setSelectedSampleId(event.target.value)}
                  value={selectedSampleId}
                >
                  {samplePrograms.map((sample) => (
                    <option key={sample.id} value={sample.id}>
                      {sample.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="rounded-[22px] border border-border/70 bg-amber-50/80 px-4 py-3">
                <p className="text-sm font-medium text-amber-950">
                  {selectedSample.description}
                </p>
                <p className="mt-1 text-sm text-amber-900/80">
                  {selectedSample.notes}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedSample.demonstrates.map((item) => (
                    <Badge className="bg-amber-900 text-amber-50" key={item}>
                      {item}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <span>{statusText}</span>
              {result?.runtimeError ? (
                <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-900">
                  Runtime stderr: {result.runtimeError}
                </span>
              ) : null}
            </div>
          </header>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
            <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
              <aside className="rounded-[28px] border border-border/70 bg-white/90 p-4 shadow-panel backdrop-blur">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Workspace files</p>
                    <p className="text-xs text-muted-foreground">
                      Flat file system, no folders.
                    </p>
                  </div>
                  <Button onClick={handleAddFile} size="sm" variant="outline">
                    <FilePlus2 className="h-4 w-4" />
                    Add
                  </Button>
                </div>

                <div className="space-y-2">
                  {files.map((file) => {
                    const hasDiagnostic = diagnosticFileNames.has(file.name)
                    return (
                      <button
                        className={cn(
                          "w-full rounded-[20px] border px-3 py-3 text-left transition-colors",
                          file.id === activeFile?.id
                            ? "border-primary bg-primary/10"
                            : "border-border bg-background hover:bg-accent",
                          hasDiagnostic && "border-red-300 bg-red-50/70",
                        )}
                        key={file.id}
                        onClick={() => setActiveFileId(file.id)}
                        type="button"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium">
                            {file.name}
                          </span>
                          {hasDiagnostic ? (
                            <AlertCircle className="h-4 w-4 text-red-600" />
                          ) : null}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {file.source.split("\n").length} lines
                        </div>
                      </button>
                    )
                  })}
                </div>
              </aside>

              <div className="rounded-[28px] border border-border/70 bg-white/90 p-4 shadow-panel backdrop-blur">
                <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center">
                  <Input
                    onChange={(event) => updateActiveFile({ name: event.target.value })}
                    placeholder="Main.java"
                    value={activeFile?.name ?? ""}
                  />
                  <Button
                    disabled={files.length === 1}
                    onClick={handleRemoveActiveFile}
                    variant="outline"
                  >
                    <Trash2 className="h-4 w-4" />
                    Remove
                  </Button>
                </div>

                <Textarea
                  className="min-h-[72vh] resize-none border-slate-800 bg-slate-950 font-mono text-[13px] leading-6 text-slate-100"
                  onChange={(event) =>
                    updateActiveFile({
                      source: normalizeIndentation(event.target.value),
                    })
                  }
                  onKeyDown={handleEditorKeyDown}
                  spellCheck={false}
                  style={{ tabSize: 2 }}
                  value={activeFile?.source ?? ""}
                />
              </div>
            </div>

            <div className="rounded-[28px] border border-border/70 bg-white/90 p-4 shadow-panel backdrop-blur">
              <div className="mb-4">
                <div className="mb-2 flex items-center gap-2">
                  <FolderKanban className="h-4 w-4 text-amber-600" />
                  <p className="text-sm font-medium">Interactive pipeline</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(result?.pipeline ?? fallbackPipeline).map((stage) => (
                    <button
                      className={cn(
                        "rounded-[20px] border px-3 py-2 text-left transition-colors",
                        stage.status === "complete" &&
                          "border-emerald-300 bg-emerald-50 text-emerald-900",
                        stage.status === "failed" &&
                          "border-red-300 bg-red-50 text-red-900",
                        stage.status === "pending" &&
                          "border-border bg-background hover:bg-accent",
                        selectedArtifactId === stage.artifactId &&
                          "ring-2 ring-amber-300 ring-offset-2",
                      )}
                      key={stage.id}
                      onClick={() => {
                        setSelectedArtifactId(stage.artifactId)
                        setActiveInspectorTab("inspector")
                      }}
                      type="button"
                    >
                      <div className="flex items-center gap-2 text-sm font-medium">
                        {stage.status === "complete" ? (
                          <CheckCircle2 className="h-4 w-4" />
                        ) : stage.status === "failed" ? (
                          <AlertCircle className="h-4 w-4" />
                        ) : (
                          <Sparkles className="h-4 w-4" />
                        )}
                        {stage.label}
                      </div>
                      <div className="text-xs opacity-75">{stage.subtitle}</div>
                    </button>
                  ))}
                </div>
              </div>

              <Tabs
                onValueChange={(value) => setActiveInspectorTab(value as InspectorTab)}
                value={activeInspectorTab}
              >
                <TabsList className="w-full justify-start">
                  <TabsTrigger value="inspector">Inspector</TabsTrigger>
                  <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
                  <TabsTrigger value="architecture">Architecture</TabsTrigger>
                </TabsList>

                <TabsContent value="inspector">
                  <InspectorPanel
                    activeFileName={activeFile?.name ?? ""}
                    artifact={selectedArtifact}
                    artifactId={selectedArtifactId}
                    onOpenGraph={(artifact) => {
                      setGraphArtifact(artifact)
                      setGraphView(artifact.svg ? "svg" : "dot")
                    }}
                    tokens={activeFileTokens}
                  />
                </TabsContent>

                <TabsContent value="diagnostics">
                  <DiagnosticsPanel diagnostics={result?.diagnostics ?? []} files={files} />
                </TabsContent>

                <TabsContent value="architecture">
                  <ArchitecturePanel />
                </TabsContent>
              </Tabs>
            </div>
          </section>
        </div>
      </main>

      {graphArtifact ? (
        <GraphModal
          artifact={graphArtifact}
          onClose={() => setGraphArtifact(null)}
          view={graphView}
          onChangeView={setGraphView}
        />
      ) : null}
    </>
  )
}

function InspectorPanel({
  artifact,
  artifactId,
  activeFileName,
  tokens,
  onOpenGraph,
}: {
  artifact: CompilerArtifact | null
  artifactId: string
  activeFileName: string
  tokens: CompilerToken[]
  onOpenGraph: (artifact: CompilerArtifact) => void
}) {
  if (artifactId === "tokens") {
    return (
      <section className="rounded-[24px] border border-border/70 bg-background/60 p-4">
        <div className="mb-4">
          <p className="text-sm font-medium">Token stream</p>
          <p className="text-sm text-muted-foreground">
            Scanner output for {activeFileName || "the active file"}.
          </p>
        </div>

        {tokens.length === 0 ? (
          <EmptyState message="Compile the workspace to inspect the scanner output for the active file." />
        ) : (
          <div className="space-y-2">
            <div className="rounded-[18px] bg-slate-950 px-4 py-3 font-mono text-xs text-slate-200">
              {tokens.map((token, index) => (
                <span
                  className={cn(
                    "mr-2 inline-flex rounded-full px-2 py-1",
                    token.category === "keyword" && "bg-blue-500/20 text-blue-200",
                    token.category === "identifier" &&
                      "bg-emerald-500/20 text-emerald-200",
                    token.category === "literal" && "bg-amber-500/20 text-amber-200",
                    token.category === "symbol" && "bg-pink-500/20 text-pink-200",
                    token.category === "other" && "bg-slate-700 text-slate-100",
                  )}
                  key={`${token.raw}-${index}`}
                  title={token.kind}
                >
                  {token.lexeme ?? token.kind}
                </span>
              ))}
            </div>

            <div className="max-h-[60vh] overflow-auto rounded-[20px] border border-border/70">
              <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-px bg-border/70 text-sm">
                {tokens.map((token, index) => (
                  <TokenRow key={`${token.raw}-${index}`} token={token} />
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
    )
  }

  if (!artifact) {
    return (
      <EmptyState message="Select a pipeline stage or compile the workspace to inspect this part of the compiler." />
    )
  }

  const hasGraph = Boolean(artifact.dot || artifact.svg)

  return (
    <section className="rounded-[24px] border border-border/70 bg-background/60 p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{artifact.label}</p>
          <p className="text-sm text-muted-foreground">{artifact.description}</p>
        </div>
        {hasGraph ? (
          <Button onClick={() => onOpenGraph(artifact)} size="sm" variant="outline">
            Open Graphviz
          </Button>
        ) : null}
      </div>

      {artifact.kind === "tree" ? (
        <div className="space-y-4">
          {artifact.tree ? (
            <div className="max-h-[54vh] overflow-auto rounded-[20px] border border-border/70 bg-white/80 p-3">
              <TreeNodeView depth={0} node={artifact.tree} />
            </div>
          ) : (
            <EmptyState message="This compiler stage did not produce a tree artifact for the current run." />
          )}
          {artifact.insights && artifact.insights.length > 0 ? (
            <ArtifactInsights tables={artifact.insights} />
          ) : null}
        </div>
      ) : (
        <Textarea
          className="min-h-[68vh] resize-none border-slate-800 bg-slate-950 font-mono text-[13px] leading-6 text-slate-100"
          readOnly
          value={artifact.text ?? ""}
        />
      )}
    </section>
  )
}

function DiagnosticsPanel({
  diagnostics,
  files,
}: {
  diagnostics: CompilerDiagnostic[]
  files: WorkspaceFile[]
}) {
  if (diagnostics.length === 0) {
    return (
      <section className="rounded-[24px] border border-emerald-200 bg-emerald-50/80 p-4">
        <div className="flex items-center gap-2 text-emerald-900">
          <CheckCircle2 className="h-5 w-5" />
          <p className="font-medium">No compiler diagnostics for this run.</p>
        </div>
        <p className="mt-2 text-sm text-emerald-800/80">
          Use the pipeline to inspect the successful stages, assembly, and runtime
          output instead.
        </p>
      </section>
    )
  }

  return (
    <div className="space-y-3">
      {diagnostics.map((diagnostic, index) => {
        const targetFile = files.find((file) => file.name === diagnostic.fileName)
        const codeFrame =
          targetFile && diagnostic.line
            ? createCodeFrame(targetFile.source, diagnostic.line)
            : null

        return (
          <section
            className="rounded-[24px] border border-red-200 bg-red-50/90 p-4"
            key={`${diagnostic.title}-${index}`}
          >
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 text-red-700" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-red-950">{diagnostic.title}</p>
                  <Badge className="bg-red-600 text-white">
                    {formatStageName(diagnostic.stage)}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-red-900">{diagnostic.message}</p>
                {diagnostic.fileName ? (
                  <p className="mt-2 text-sm text-red-800/80">
                    {diagnostic.fileName}
                    {diagnostic.line ? `:${diagnostic.line}` : ""}
                    {diagnostic.column ? `:${diagnostic.column}` : ""}
                  </p>
                ) : null}

                {codeFrame ? (
                  <pre className="mt-3 overflow-auto rounded-[18px] bg-slate-950 p-3 font-mono text-xs text-slate-100">
                    {codeFrame}
                  </pre>
                ) : null}
              </div>
            </div>
          </section>
        )
      })}
    </div>
  )
}

function ArchitecturePanel() {
  return (
    <div className="space-y-4">
      <section className="rounded-[24px] border border-border/70 bg-background/60 p-4">
        <p className="text-sm font-medium">Architecture</p>
        <div className="mt-3 space-y-3">
          {architectureSteps.map((step, index) => (
            <div
              className="rounded-[18px] border border-border/70 bg-white/80 px-3 py-3 text-sm"
              key={step}
            >
              <div className="font-medium">Step {index + 1}</div>
              <div className="mt-1 text-muted-foreground">{step}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[24px] border border-border/70 bg-background/60 p-4">
        <p className="text-sm font-medium">Compiler feature checklist</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {featureChecklist.map((item) => (
            <div
              className="flex items-center gap-2 rounded-[18px] border border-emerald-200 bg-emerald-50/80 px-3 py-3 text-sm text-emerald-950"
              key={item}
            >
              <CheckCircle2 className="h-4 w-4" />
              {item}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function ArtifactInsights({
  tables,
}: {
  tables: NonNullable<CompilerArtifact["insights"]>
}) {
  return (
    <div className="space-y-4">
      {tables.map((table) => (
        <section
          className="rounded-[20px] border border-border/70 bg-white/80 p-3"
          key={table.id}
        >
          <div className="mb-3">
            <p className="text-sm font-medium">{table.title}</p>
            <p className="text-sm text-muted-foreground">{table.description}</p>
          </div>
          <div className="max-h-[26vh] overflow-auto rounded-[16px] border border-border/70">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead className="sticky top-0 bg-amber-50">
                <tr>
                  {table.columns.map((column) => (
                    <th
                      className="border-b border-border/70 px-3 py-2 font-medium text-amber-950"
                      key={column}
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, index) => (
                  <tr className="odd:bg-slate-50/80" key={`${table.id}-${index}`}>
                    {row.map((value, cellIndex) => (
                      <td
                        className="border-b border-border/60 px-3 py-2 font-mono text-xs text-slate-800"
                        key={`${table.id}-${index}-${cellIndex}`}
                      >
                        {value}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  )
}

function GraphModal({
  artifact,
  view,
  onChangeView,
  onClose,
}: {
  artifact: CompilerArtifact
  view: "svg" | "dot"
  onChangeView: (view: "svg" | "dot") => void
  onClose: () => void
}) {
  const [zoom, setZoom] = useState(1)
  const [copied, setCopied] = useState(false)
  const svgDataUri = artifact.svg
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(artifact.svg)}`
    : null

  function handleCopyDot() {
    if (!artifact.dot) {
      return
    }

    navigator.clipboard.writeText(artifact.dot).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }

  function handleZoomIn() {
    setZoom((currentZoom) => Math.min(3, currentZoom + 0.2))
  }

  function handleZoomOut() {
    setZoom((currentZoom) => Math.max(0.4, currentZoom - 0.2))
  }

  function handleResetZoom() {
    setZoom(1)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div className="flex h-[96vh] w-[96vw] max-w-[1800px] flex-col rounded-[28px] border border-border/70 bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-lg font-semibold">{artifact.label}</p>
            <p className="text-sm text-muted-foreground">{artifact.description}</p>
          </div>
          <Button onClick={onClose} size="icon" variant="outline">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="mb-4 flex gap-2">
          {artifact.svg ? (
            <Button
              className={cn(view === "svg" && "border-primary")}
              onClick={() => onChangeView("svg")}
              size="sm"
              variant="outline"
            >
              Rendered graph
            </Button>
          ) : null}
          {artifact.dot ? (
            <Button
              className={cn(view === "dot" && "border-primary")}
              onClick={() => onChangeView("dot")}
              size="sm"
              variant="outline"
            >
              Raw .dot
            </Button>
          ) : null}
          {artifact.dot && view === "dot" ? (
            <Button onClick={handleCopyDot} size="sm" variant="outline">
              <Copy className="h-4 w-4" />
              {copied ? "Copied" : "Copy .dot"}
            </Button>
          ) : null}
        </div>

        {view === "svg" && svgDataUri ? (
          <div className="relative min-h-0 flex-1 overflow-auto rounded-[20px] border border-border/70 bg-slate-50 p-4">
            <div className="absolute right-4 top-4 z-10 flex gap-2 rounded-full border border-border/70 bg-white/95 p-1 shadow-lg">
              <Button onClick={handleZoomOut} size="icon" variant="outline">
                <Minus className="h-4 w-4" />
              </Button>
              <Button onClick={handleResetZoom} size="sm" variant="outline">
                {Math.round(zoom * 100)}%
              </Button>
              <Button onClick={handleZoomIn} size="icon" variant="outline">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <img
              alt={`${artifact.label} graph`}
              className="max-w-none origin-top-left"
              src={svgDataUri}
              style={{ transform: `scale(${zoom})` }}
            />
          </div>
        ) : (
          <Textarea
            className="min-h-0 flex-1 resize-none border-slate-800 bg-slate-950 font-mono text-[13px] leading-6 text-slate-100"
            readOnly
            value={artifact.dot ?? artifact.text ?? ""}
          />
        )}
      </div>
    </div>
  )
}

function TokenRow({ token }: { token: CompilerToken }) {
  return (
    <>
      <div className="bg-background px-3 py-2 font-mono text-xs uppercase tracking-wide text-muted-foreground">
        {token.kind}
      </div>
      <div className="bg-background px-3 py-2 font-mono text-sm text-foreground">
        {token.lexeme ?? token.kind}
      </div>
    </>
  )
}

function TreeNodeView({
  node,
  depth,
}: {
  node: CompilerTreeNode
  depth: number
}) {
  const hasChildren = node.children.length > 0

  if (!hasChildren) {
    return (
      <div className="pl-4" style={{ marginLeft: `${depth * 12}px` }}>
        <div className="rounded-[14px] px-3 py-1.5 font-mono text-sm text-slate-800">
          {node.label}
        </div>
      </div>
    )
  }

  return (
    <details className="group" open={depth < 2}>
      <summary
        className="flex cursor-pointer list-none items-center gap-2 rounded-[16px] px-3 py-2 font-mono text-sm text-slate-900 hover:bg-amber-50"
        style={{ marginLeft: `${depth * 12}px` }}
      >
        <span className="text-amber-700 transition-transform group-open:rotate-90">
          ▶
        </span>
        <span>{node.label}</span>
        <span className="text-xs text-muted-foreground">
          {node.children.length} child{node.children.length === 1 ? "" : "ren"}
        </span>
      </summary>
      <div className="mt-1 border-l border-amber-200/80">
        {node.children.map((child) => (
          <TreeNodeView depth={depth + 1} key={child.id} node={child} />
        ))}
      </div>
    </details>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-[24px] border border-dashed border-border/70 bg-background/60 p-8 text-center text-sm text-muted-foreground">
      {message}
    </div>
  )
}

function getSelectedArtifact(
  result: CompilerResult | null,
  artifactId: string,
): CompilerArtifact | null {
  if (!result) {
    return artifactId === "source-summary"
      ? {
          id: "source-summary",
          label: "Source Workspace",
          description: "The current flat set of Java files that will be sent to the compiler.",
          kind: "text",
          text: "Compile the workspace to generate compiler artifacts.",
        }
      : null
  }

  return result.artifacts.find((artifact) => artifact.id === artifactId) ?? null
}

function createCodeFrame(source: string, lineNumber: number) {
  const lines = source.split("\n")
  const start = Math.max(0, lineNumber - 2)
  const end = Math.min(lines.length, lineNumber + 1)

  return lines
    .slice(start, end)
    .map((line, index) => {
      const currentLineNumber = start + index + 1
      const prefix = currentLineNumber === lineNumber ? ">" : " "
      return `${prefix} ${String(currentLineNumber).padStart(3, " ")} | ${line}`
    })
    .join("\n")
}

function normalizeIndentation(source: string) {
  return source.replace(/\t/g, TAB_STRING)
}

function createEmptyWorkspaceFiles(
  nextFileId: React.MutableRefObject<number>,
): WorkspaceFile[] {
  return [
    {
      id: `file-${nextFileId.current++}`,
      name: "Main.java",
      source: normalizeIndentation(`public class Main {
  public Main() {}

  public static int test() {
    return 123;
  }
}
`),
    },
  ]
}

function createWorkspaceFiles(
  sample: SampleProgram,
  nextFileId: React.MutableRefObject<number>,
) {
  return sample.files.map((file) => ({
    id: `file-${nextFileId.current++}`,
    name: file.name,
    source: normalizeIndentation(file.source),
  }))
}

function createUntitledFileName(files: WorkspaceFile[]) {
  let index = 1

  while (true) {
    const candidate = `File${index}.java`
    const alreadyExists = files.some((file) => file.name === candidate)
    if (!alreadyExists) {
      return candidate
    }
    index = index + 1
  }
}

function formatStageName(stage: string) {
  return stage
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

const fallbackPipeline: CompilerPipelineStage[] = [
  {
    id: "source",
    label: "Source",
    subtitle: "workspace",
    status: "pending",
    artifactId: "source-summary",
  },
  {
    id: "lexing",
    label: "Lexing",
    subtitle: "scanner",
    status: "pending",
    artifactId: "tokens",
  },
  {
    id: "frontend",
    label: "AST",
    subtitle: "parse + weed",
    status: "pending",
    artifactId: "frontend-tree",
  },
  {
    id: "resolution",
    label: "Environment",
    subtitle: "symbol table",
    status: "pending",
    artifactId: "resolved-tree",
  },
  {
    id: "hierarchy",
    label: "Hierarchy",
    subtitle: "classes",
    status: "pending",
    artifactId: "hierarchy-tree",
  },
  {
    id: "disambiguation",
    label: "Bindings",
    subtitle: "resolved uses",
    status: "pending",
    artifactId: "disambiguated-tree",
  },
  {
    id: "typecheck",
    label: "Semantics",
    subtitle: "types + calls",
    status: "pending",
    artifactId: "typechecked-tree",
  },
  {
    id: "codegen",
    label: "Codegen",
    subtitle: "assembly",
    status: "pending",
    artifactId: "assembly",
  },
  {
    id: "output",
    label: "Output",
    subtitle: "runtime",
    status: "pending",
    artifactId: "output",
  },
]

export default App
