import path, { resolve, parse } from "path";
import { build } from "vite";
import { zip } from "zip-a-folder";
import fs from "fs";
import fse from "fs-extra";
import { createFilter } from "@rollup/pluginutils";
import parser from "@babel/parser";
import traverse from "@babel/traverse";
import generate from "@babel/generator";

function resolveConfig(path) {
  let member = "npm_package";

  for (const part of path) {
    member += `_${part}`;
  }

  return process.env[member];
}

function resolveResource(root, source, infix = []) {
  return path.resolve(root, ...infix, source);
}

function transformerPlugin(options = {}, compilerOptions = {}) {
  const filter = createFilter(options.include, options.exclude);

  let remoteDirectory = resolveConfig([
    compilerOptions.metaIdentifier,
    compilerOptions.remoteIdentifier,
    "dir",
  ]);

  remoteDirectory = resolveResource(
    compilerOptions.root,
    `../src/${remoteDirectory}`
  );

  return {
    name: "kasif-plugin-transformer",
    resolveId(source) {
      if (source === "virtual-module") {
        return source;
      }
      return null;
    },
    load(id) {
      if (id === "virtual-module") {
        return 'export default "This is virtual!"';
      }
      return null;
    },
    transform(code, id) {
      if (!filter(id)) return;

      const ast = parser.parse(code, {
        sourceType: "module",
        plugins: ["typescript"],
      });

      traverse.default(ast, {
        ImportDeclaration(path) {
          const importDirectory = parse(
            resolve(parse(id).dir, path.node.source.value)
          ).dir;

          if (importDirectory === remoteDirectory) {
            path.stop();
            const importedKeys = [];

            for (const specifier of path.node.specifiers) {
              importedKeys.push({
                imported: specifier.imported.name,
                local: specifier.local.name,
              });
            }

            const name = resolveConfig([
              compilerOptions.metaIdentifier,
              "identifier",
            ]);

            path.replaceWithMultiple(
              importedKeys.map(
                ({ imported, local }) =>
                  parser.parse(
                    `const ${local} = window["${name}"].remote.functions.${imported}`
                  ).program.body[0]
              )
            );
          }
        },
      });

      return generate.default(ast, {}, code);
    },
  };
}

export class Compiler {
  constructor(options) {
    this.options = options;
  }

  async #build() {
    let plugin;

    switch (this.options.framework) {
      case "svelte": {
        const mod = await import("@sveltejs/vite-plugin-svelte");
        const frameworkPlugin = mod.svelte;
        plugin = frameworkPlugin({
          compilerOptions: {
            css: true,
          },
        });
        break;
      }
      case "vue": {
        const frameworkPlugin = await import("@vitejs/plugin-vue");
        plugin = frameworkPlugin.default();
        break;
      }
    }

    const transformer = transformerPlugin(
      {
        include: ["**/*.ts", "**/*.js"],
      },
      this.options
    );

    await build({
      plugins: plugin
        ? [{ ...transformer, enforce: "pre" }, plugin]
        : [transformer],
      build: {
        lib: {
          entry: resolveResource(
            this.options.root,
            `../src/${resolveConfig([
              this.options.metaIdentifier,
              "lib",
              "dir",
            ])}/${resolveConfig([
              this.options.metaIdentifier,
              "lib",
              "entry",
            ])}.ts`
          ),
          name: "plugin",
          formats: ["es"],
          fileName: () =>
            `${resolveConfig([
              this.options.metaIdentifier,
              "lib",
              "entry",
            ])}.js`,
        },
        rollupOptions: {
          external: [],
          output: {
            globals: {},
          },
        },
        sourcemap: true,
        outDir: `./.kasif/${this.options.tmpPath}`,
      },
      resolve: {
        alias: {},
      },
    });
  }

  async #package() {
    await fs.promises.rm(resolveResource(this.options.root, "../dist"), {
      recursive: true,
      force: true,
    });
    await fs.promises.mkdir(resolveResource(this.options.root, "../dist"));

    await fs.promises.copyFile(
      resolveResource(this.options.root, `../${this.options.manfiestFile}`),
      resolveResource(
        this.options.root,
        `./${this.options.tmpPath}/${this.options.manfiestFile}`
      )
    );

    fse.copySync(
      resolveResource(
        this.options.root,
        `../src/${resolveConfig([
          this.options.metaIdentifier,
          this.options.remoteIdentifier,
          "dir",
        ])}`
      ),
      resolveResource(
        this.options.root,
        `./${this.options.tmpPath}/${resolveConfig([
          this.options.metaIdentifier,
          this.options.remoteIdentifier,
          "dir",
        ])}`
      ),
      { overwrite: true }
    );

    await zip(
      resolveResource(this.options.root, `./${this.options.tmpPath}`),
      resolveResource(
        this.options.root,
        `../dist/${resolveConfig([
          this.options.metaIdentifier,
          "identifier",
        ])}.${this.options.extension}`
      )
    );

    await fs.promises.rm(
      resolveResource(this.options.root, `./${this.options.tmpPath}`),
      {
        recursive: true,
        force: true,
      }
    );
  }

  async compile() {
    await this.#build();
    await this.#package();
  }
}
