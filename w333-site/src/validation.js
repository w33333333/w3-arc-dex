export function matchesRuntime(actual, artifact) {
  const mask = (code) => {
    let hex = code.toLowerCase().slice(2);
    for (const refs of Object.values(artifact.immutableReferences ?? {}))
      for (const { start, length } of refs)
        hex =
          hex.slice(0, start * 2) +
          "0".repeat(length * 2) +
          hex.slice((start + length) * 2);
    return hex;
  };
  return (
    actual.length === artifact.deployedBytecode.length &&
    mask(actual) === mask(artifact.deployedBytecode)
  );
}
