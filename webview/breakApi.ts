declare function acquireVsCodeApi(): { postMessage(m: { type: "done" | "snooze" | "skip" }): void };
export const breakApi = acquireVsCodeApi();
