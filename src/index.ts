import path from "path";
import { TextChange } from "typescript";
import { ChangedFile, createProject, Project } from "./ts";
import * as fs from "fs";

interface Logger {
  (...args: any[]): void;
  error?(...args: any[]): void;
  warn?(...args: any[]): void;
  info?(...args: any[]): void;
  verbose?(...args: any[]): void;
}
interface Host {
  // Emits one particular file with input fileName and content string
  writeFile(fileName: string, content: string): void;

  getNewLine(): string;

  // Adds map of text changes that were not applied
  log: Logger;

  mkdir: typeof import("fs").mkdirSync;
  exists: typeof import("fs").existsSync;
}

export class CLIHost implements Host {
  constructor(private cwd: string) { };

  writeFile(fileName: string, content: string) { fs.writeFileSync(fileName, content, 'utf8') };

  log(s: string) { console.log(s) };

  mkdir(directoryPath: fs.PathLike) { return fs.mkdirSync(directoryPath, { recursive: true }) };

  exists(fileName: fs.PathLike) { return fs.existsSync(fileName) };

  getNewLine() { return "\r\n" }
}

export interface Options {
  cwd: string;
  tsconfig: string;
  outputFolder: string;
  file: string[];
  write: boolean,
}

// Check git status and paths to provided files if applicable
const checkOptions = (opt: Options): [string[], string[]] => {
  // Keep track of provided files regardless if they are valid or invalid
  // If all file paths are invalid throw an error
  let validFiles = new Array<string>;
  let invalidFiles = new Array<string>;
  if (opt.file.length) {
    opt.file.forEach((file) => {
      file = path.join(path.dirname(opt.tsconfig), file);
      if (fs.existsSync(file)) {
        validFiles.push(file);
      }
      else {
        invalidFiles.push(file);
      }
    });
    if (!validFiles.length) {
      throw new Error(`All provided files are invalid`);
    }
  }
  return [validFiles, invalidFiles];
}

export function codefixProject(opt: Options, host: Host): string {
  const [validFiles, invalidFiles] = checkOptions(opt);

  if (invalidFiles.length) {
    host.log(`${host.getNewLine()}The following file paths are invalid:`);
    invalidFiles.forEach((file) => host.log(file));
  }

  const allChangedFiles = new Map<string, ChangedFile>();

  const project = createProject({ tsConfigFilePath: opt.tsconfig }, allChangedFiles);
  if (!project) {
    return "Error: Could not create project.";
  }

  host.log(`Using TypeScript ${project.ts.version}`);

  for (const {fileName, textChanges} of genCodeFixesFromProject(project, host, opt.file.length > 0 ? new Set(validFiles) : null)) {
    host.log('Applying fixes to file: ' + fileName)
    const sourceFile = project.program.getSourceFile(fileName);
    if (sourceFile === undefined) {
      throw new Error(`File ${fileName} not found in project`);
    }
    const changedFile = doTextChanges(sourceFile.text, textChanges);
    allChangedFiles.set(fileName, {originalText: sourceFile.text, newText: changedFile});

    if (opt.write) {
        writeToFile(fileName, changedFile, opt, host);
    }
  }

  return "Done";
}

function* genCodeFixesFromProject(project: Project, host: Host, files: ReadonlySet<string> | null): Generator<{fileName: string, textChanges: readonly TextChange[]}> {  
  for (const file of project.program.getSourceFiles()) {
    if (/[\\/]node_modules[\\/]/.test(file.fileName)) {
      continue;
    }

    if (file.isDeclarationFile) {
      continue;
    }

    if (files !== null && !files.has(file.fileName)) {
      continue;
    }

    const service = project.languageService;

    host.log('Getting codefixes for ' + file.fileName);

    const codefix = service.getCombinedCodeFix(
      {
        type: 'file',
        fileName: file.fileName,
      },
      'fixMissingTypeAnnotationOnExports',
      {},
      {
        allowRenameOfImportPath: false,
        autoImportFileExcludePatterns: ['**/react/jsx-runtime'],
      },
    );

    if (codefix.changes.length === 0) {
      continue;
    }

    if (codefix.changes.length > 1) {
      host.log('Multiple fixes found for ' + file.fileName);
    }

    yield {fileName: file.fileName, textChanges: codefix.changes[0]!.textChanges};
  }
}


function doTextChanges(fileText: string, textChanges: readonly TextChange[]): string {
  // iterate through codefixes from back
  for (let i = textChanges.length - 1; i >= 0; i--) {
    // apply each codefix
    fileText = doTextChangeOnString(fileText, textChanges[i]);
  }
  return fileText;
}

function doTextChangeOnString(currentFileText: string, change: TextChange): string {
  const prefix = currentFileText.substring(0, change.span.start);
  const middle = change.newText;
  const suffix = currentFileText.substring(change.span.start + change.span.length);
  return prefix + middle + suffix;
}

function getDirectory(filePath: string): string {
  return path.dirname(filePath);
}

function getRelativePath(filePath: string, opt: Options): string {
  // this doesn't work when tsconfig or filepath is not passed in as absolute...
  // as a result getOutputFilePath does not work for the non-replace option 
  return path.relative(getDirectory(opt.tsconfig), path.resolve(filePath));
}

function getOutputFilePath(filePath: string, opt: Options): string {
  // this function uses absolute paths
  const fileName = getRelativePath(filePath, opt);
  return path.resolve(opt.outputFolder, fileName);
}

function writeToFile(fileName: string, fileContents: string, opt: Options, host: Host): string {
  const writeToFileName = getOutputFilePath(fileName, opt);
  const writeToDirectory = getDirectory(writeToFileName)
  if (!host.exists(writeToDirectory)) {
    host.mkdir(writeToDirectory);
  }
  host.writeFile(writeToFileName, fileContents);
  host.log("Updated " + path.relative(opt.cwd, writeToFileName));
  return writeToFileName;
}