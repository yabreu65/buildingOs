#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const appRoot = path.resolve(__dirname, '..');
const ignoredDirs = new Set(['node_modules', '.next', 'coverage']);
const testFilePattern = /\.(spec|test)\.tsx?$/;
const allowedFocusedRoots = new Set(['describe', 'it', 'test']);
const focusedAliases = new Set(['fdescribe', 'fit']);

const getRootIdentifier = (expression) => {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }

  if (ts.isPropertyAccessExpression(expression)) {
    return getRootIdentifier(expression.expression);
  }

  if (ts.isCallExpression(expression)) {
    return getRootIdentifier(expression.expression);
  }

  if (ts.isParenthesizedExpression(expression)) {
    return getRootIdentifier(expression.expression);
  }

  return undefined;
};

const hasOnlyProperty = (expression) => {
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text === 'only' || hasOnlyProperty(expression.expression);
  }

  if (ts.isCallExpression(expression)) {
    return hasOnlyProperty(expression.expression);
  }

  if (ts.isParenthesizedExpression(expression)) {
    return hasOnlyProperty(expression.expression);
  }

  return false;
};

const isFocusedTestCall = (expression) => {
  if (ts.isCallExpression(expression)) {
    return false;
  }

  const root = getRootIdentifier(expression);
  return root ? focusedAliases.has(root) || (allowedFocusedRoots.has(root) && hasOnlyProperty(expression)) : false;
};

const collectTestFiles = (dir, files = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) {
      continue;
    }

    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTestFiles(entryPath, files);
      continue;
    }

    if (entry.isFile() && testFilePattern.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
};

const findFocusedCalls = (filePath) => {
  const sourceText = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const findings = [];

  const visit = (node) => {
    if (ts.isCallExpression(node) && isFocusedTestCall(node.expression)) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.expression.getStart(sourceFile));
      findings.push({
        file: path.relative(appRoot, filePath),
        line: position.line + 1,
        column: position.character + 1,
        api: node.expression.getText(sourceFile),
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return findings;
};

const files = collectTestFiles(appRoot).sort();
const findings = files.flatMap(findFocusedCalls);

if (findings.length > 0) {
  console.error('Focused Jest tests are forbidden in web CI. Remove these before committing:');
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line}:${finding.column} uses ${finding.api}`);
  }
  process.exit(1);
}

console.log(`Focused-test guard scanned ${files.length} web test files.`);
