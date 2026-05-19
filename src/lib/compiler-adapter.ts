import type { CompileRequest, CompilerResult } from "@/lib/compiler-types"

export async function compileSource(
  request: CompileRequest,
): Promise<CompilerResult> {
  const response = await fetch("/api/run", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  })

  const result = (await response.json()) as CompilerResult

  if (!response.ok) {
    return result
  }

  return result
}
