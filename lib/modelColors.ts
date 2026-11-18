// Mark colors for charts and diagrams, one per model, validated as a categorical
// palette on the app's dark surfaces (#111111, #0a0a0a): lightness band, chroma,
// colorblind separation (worst pair ΔE 12.0), normal-vision separation and 3:1
// contrast all pass. They stay close to the badge colors used elsewhere (green,
// blue, purple), which fail as chart marks: blue vs purple is ΔE 1.3 for deutan.
// Use them for marks (bars, borders, dots), never for text.
export const MODEL_MARK: Record<string, string> = {
  nano: "#5f9e00",
  super: "#3987e5",
  sol: "#c2459f",
};

export function modelKey(modelId: string | undefined): "nano" | "super" | "sol" | undefined {
  if (!modelId) return undefined;
  if (modelId.includes("nano")) return "nano";
  if (modelId.includes("super")) return "super";
  if (modelId.includes("sol")) return "sol";
  return undefined;
}

export function modelName(modelId: string): string {
  if (modelId.includes("nemotron-nano")) return "Nemotron Nano 30B";
  if (modelId.includes("nemotron-super")) return "Nemotron Super 120B";
  if (modelId.includes("gpt-5.6-sol")) return "GPT-5.6 Sol";
  return modelId;
}

export const usd = (v: number) => `$${v < 0.01 ? v.toFixed(5) : v.toFixed(4)}`;
