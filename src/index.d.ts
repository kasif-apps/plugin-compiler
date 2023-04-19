type CompilerOptions = {
  root: string;
  metaIdentifier: string;
  remoteIdentifier: string;
  extension: string;
  manfiestFile: string;
  tmpPath: string;
  framework: "svelte" | "vue" | "react";
};

declare class Compiler {
  constructor(options: CompilerOptions);
  compile(): void;
}
