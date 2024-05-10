#!/usr/bin/env node

import yargs from 'yargs';
import path from "path";
import { Options, codefixProject, CLIHost } from '.';

export function makeOptions(cwd: string, args: string[]): Options {
    const {
        file,
        outputFolder,
        tsconfig,
        write,
    } = yargs(args)
        .scriptName("ts-fix")
        .usage("$0 -t path/to/tsconfig.json")
        .option("file", {
            description: "Relative paths to the file(s) for which to find diagnostics",
            type: "string",
            array: true,
            default: []
        })
        .option("outputFolder", {
            alias: "o",
            describe: "Path of output directory",
            type: "string"
        })
        .option("tsconfig", {
            alias: "t",
            description: "Path to project's tsconfig",
            type: "string",
            nargs: 1,
            default: "./tsconfig.json",
            coerce: (arg: string) => {
                return path.resolve(cwd, arg);
            }
        })
        .option("write", {
            alias: "w",
            describe: "Tool will only emit or overwrite files if --write is included.",
            type: "boolean",
            default: false
        })
        .argv;
    return {
        cwd,
        file,
        outputFolder : outputFolder ? path.resolve(cwd, outputFolder) : path.dirname(tsconfig),
        tsconfig,
        write,
    };
}

if (!module.parent) {
    const opt = makeOptions(process.cwd(), process.argv.slice(2));
    let host = new CLIHost(process.cwd());
    (async () => {
        const error = codefixProject(opt, host);
        host.log(error);
    })();
}

