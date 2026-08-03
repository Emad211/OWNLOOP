import type { CandidateGenerationProviderOptions } from "./request.js";

export const AVALAI_IR_BASE_URL = "https://api.avalai.ir/v1" as const;
export const AVALAI_GLOBAL_BASE_URL = "https://api.avalai.org/v1" as const;

export type AvalAiRegion = "iran" | "global";

export type AvalAiCandidateGenerationOptions = Readonly<
  Omit<CandidateGenerationProviderOptions, "baseUrl"> & {
    region?: AvalAiRegion;
  }
>;

export function avalAiBaseUrl(region: AvalAiRegion = "iran"): string {
  return region === "global" ? AVALAI_GLOBAL_BASE_URL : AVALAI_IR_BASE_URL;
}

export function createAvalAiCandidateGenerationProviderOptions(
  input: AvalAiCandidateGenerationOptions,
): CandidateGenerationProviderOptions {
  const { region = "iran", ...provider } = input;
  return {
    ...provider,
    baseUrl: avalAiBaseUrl(region),
  };
}
