import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

function findDtoFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findDtoFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.dto.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

interface UndecoratedProperty {
  file: string;
  className: string;
  propertyName: string;
}

const VALIDATION_DECORATOR_PREFIXES = [
  'Is',
  'Validate',
  'Min',
  'Max',
  'Matches',
  'Contains',
  'Length',
  'Array',
  'Allow',
  'Equals',
  'NotEquals',
];

function isValidationDecorator(decoratorName: string): boolean {
  return VALIDATION_DECORATOR_PREFIXES.some((prefix) => decoratorName.startsWith(prefix));
}

function getDecoratorName(decorator: ts.Decorator): string | null {
  const expr = decorator.expression;
  if (ts.isCallExpression(expr)) {
    if (ts.isIdentifier(expr.expression)) {
      return expr.expression.text;
    }
  } else if (ts.isIdentifier(expr)) {
    return expr.text;
  }
  return null;
}

function findUndecoratedDtoProperties(dtoFiles: string[]): UndecoratedProperty[] {
  const missing: UndecoratedProperty[] = [];

  for (const file of dtoFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    const sourceFile = ts.createSourceFile(
      file,
      content,
      ts.ScriptTarget.Latest,
      true,
    );

    function visit(node: ts.Node, currentClass?: string) {
      if (ts.isClassDeclaration(node)) {
        const className = node.name?.text ?? 'AnonymousClass';
        ts.forEachChild(node, (child) => visit(child, className));
        return;
      }

      if (ts.isPropertyDeclaration(node) && currentClass) {
        const propertyName = node.name.getText(sourceFile);
        
        // Skip static properties
        const isStatic = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword);
        if (isStatic) {
          return;
        }

        const decorators = ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
        const hasValidationDecorator = decorators.some((d) => {
          const name = getDecoratorName(d);
          return name !== null && isValidationDecorator(name);
        });

        if (!hasValidationDecorator) {
          missing.push({
            file: path.relative(process.cwd(), file),
            className: currentClass,
            propertyName,
          });
        }
      }

      ts.forEachChild(node, (child) => visit(child, currentClass));
    }

    visit(sourceFile);
  }

  return missing;
}

describe('DTO Validation Structural Enforcement (Task 3.6)', () => {
  it('enforces that every property in every DTO file has at least one class-validator decorator', () => {
    const srcDir = path.resolve(__dirname, '..');
    const dtoFiles = findDtoFiles(srcDir);

    expect(dtoFiles.length).toBeGreaterThan(10);

    const undecorated = findUndecoratedDtoProperties(dtoFiles);

    if (undecorated.length > 0) {
      const errorMsg = undecorated
        .map((u) => `  - ${u.file} -> ${u.className}.${u.propertyName}`)
        .join('\n');
      throw new Error(
        `Found ${undecorated.length} DTO properties with ZERO class-validator validation decorators (would be silently stripped by ValidationPipe whitelist: true):\n${errorMsg}`,
      );
    }

    expect(undecorated).toHaveLength(0);
  });

  it('fails when a DTO property has non-validator decorators or no decorators (verification test)', () => {
    const fixtureCode = `
      export class TestExampleDto {
        @IsString()
        validField!: string;

        @ApiProperty()
        nonValidatorDecoratedField!: number;

        unvalidatedField!: number;
      }
    `;
    const sourceFile = ts.createSourceFile('fixture.dto.ts', fixtureCode, ts.ScriptTarget.Latest, true);
    const failedFields: string[] = [];

    function visit(node: ts.Node) {
      if (ts.isPropertyDeclaration(node)) {
        const decorators = ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
        const hasValidator = decorators.some((d) => {
          const name = getDecoratorName(d);
          return name !== null && isValidationDecorator(name);
        });
        if (!hasValidator) {
          failedFields.push(node.name.getText(sourceFile));
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);

    expect(failedFields).toEqual(['nonValidatorDecoratedField', 'unvalidatedField']);
  });
});
