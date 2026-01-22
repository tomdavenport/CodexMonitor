function getPlatformLabel() {
  if (typeof navigator === "undefined") {
    return "";
  }
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } })
      .userAgentData?.platform ?? navigator.platform ?? "";
  return platform.toLowerCase();
}

export function isLinuxPlatform() {
  const normalized = getPlatformLabel();
  if (normalized) {
    return normalized.includes("linux");
  }
  if (typeof navigator === "undefined") {
    return false;
  }
  return /linux/i.test(navigator.userAgent);
}

export function getFileManagerLabel() {
  const normalized = getPlatformLabel();
  if (normalized.includes("mac")) {
    return "Finder";
  }
  if (normalized.includes("win")) {
    return "Explorer";
  }
  return "File Manager";
}

export function getRevealLabel() {
  const normalized = getPlatformLabel();
  if (normalized.includes("mac")) {
    return "Reveal in Finder";
  }
  if (normalized.includes("win")) {
    return "Show in Explorer";
  }
  return "Reveal in File Manager";
}
