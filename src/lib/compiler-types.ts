export interface CompileRequest {
  files: SourceFile[]
  primaryFileName?: string
}

export interface SourceFile {
  name: string
  source: string
}

export type PipelineStageStatus = "complete" | "failed" | "pending"

export interface CompilerDiagnostic {
  severity: "error" | "warning"
  stage: string
  title: string
  message: string
  fileName?: string
  line?: number
  column?: number
}

export interface CompilerToken {
  raw: string
  kind: string
  lexeme: string | null
  category: "keyword" | "identifier" | "literal" | "symbol" | "other"
}

export interface CompilerTreeNode {
  id: string
  label: string
  children: CompilerTreeNode[]
}

export interface CompilerArtifact {
  id: string
  label: string
  description: string
  kind: "text" | "tree"
  text?: string
  tree?: CompilerTreeNode | null
  dot?: string
  svg?: string
  insights?: CompilerInsightTable[]
}

export interface CompilerInsightTable {
  id: string
  title: string
  description: string
  columns: string[]
  rows: string[][]
}

export interface CompilerPipelineStage {
  id: string
  label: string
  subtitle: string
  status: PipelineStageStatus
  detail?: string
  artifactId: string
}

export interface CompilerResult {
  ok: boolean
  stage: string
  output: string
  assembly: string
  pipeline: CompilerPipelineStage[]
  diagnostics: CompilerDiagnostic[]
  artifacts: CompilerArtifact[]
  tokensByFile: Record<string, CompilerToken[]>
  compileMs?: number
  runMs?: number
  exitCode?: number
  runtimeError?: string
}

export interface SampleProgram {
  id: string
  name: string
  description: string
  notes: string
  demonstrates: string[]
  files: SourceFile[]
}
