import fs from "node:fs";
import path from "node:path";
import solc from "solc";
const sources = Object.fromEntries(
  fs
    .readdirSync("contracts")
    .filter((f) => f.endsWith(".sol"))
    .map((f) => [
      `contracts/${f}`,
      { content: fs.readFileSync(`contracts/${f}`, "utf8") },
    ]),
);
const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "paris",
    outputSelection: {
      "*": {
        "*": [
          "abi",
          "evm.bytecode.object",
          "evm.deployedBytecode.object",
          "evm.deployedBytecode.immutableReferences",
        ],
      },
    },
  },
};
const resolved = { ...sources };
const output = JSON.parse(
  solc.compile(JSON.stringify(input), {
    import: (name) => {
      const file = path.join("node_modules", name);
      if (!fs.existsSync(file)) return { error: `Missing import: ${name}` };
      const content = fs.readFileSync(file, "utf8");
      resolved[name] = { content };
      return { contents: content };
    },
  }),
);
for (const e of output.errors ?? []) console.error(e.formattedMessage);
if (output.errors?.some((e) => e.severity === "error")) process.exit(1);
fs.mkdirSync("artifacts", { recursive: true });
for (const [file, contracts] of Object.entries(output.contracts)) {
  if (!file.startsWith("contracts/")) continue;
  for (const [name, c] of Object.entries(contracts)) {
    const artifact = {
      contractName: name,
      compiler: solc.version(),
      abi: c.abi,
      bytecode: "0x" + c.evm.bytecode.object,
      deployedBytecode: "0x" + c.evm.deployedBytecode.object,
      immutableReferences: c.evm.deployedBytecode.immutableReferences,
    };
    fs.writeFileSync(
      `artifacts/${name}.json`,
      JSON.stringify(artifact, null, 2),
    );
    if (name === "InventoryBridge") {
      fs.mkdirSync("public", { recursive: true });
      fs.writeFileSync("public/InventoryBridge.json", JSON.stringify(artifact));
      const bytes = c.evm.deployedBytecode.object.length / 2;
      if (bytes > 24576) throw Error(`Contract too large: ${bytes}`);
      console.log(
        `${name}: ${bytes} runtime bytes; compiler ${solc.version()}`,
      );
    }
  }
}
fs.writeFileSync(
  "artifacts/standard-input.json",
  JSON.stringify({ ...input, sources: resolved }, null, 2),
);
