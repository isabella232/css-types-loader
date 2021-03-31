/* eslint-disable @typescript-eslint/no-var-requires */
const path = require('path')
const fs = require('fs')

const loaderUtils = require('loader-utils')
const ts = require('typescript')
const prettier = require('prettier')

const printer = ts.createPrinter({
  newLine: ts.NewLineKind.LineFeed,
  removeComments: false,
  omitTrailingSemicolon: true
})

let prettierConfig

/**
 * Finds `export.locals` in the tree and extracts the keys
 */
function getLocalExports(input) {
  const locals = input.statements.find(
    statement =>
      ts.isExpressionStatement(statement) &&
      ts.isBinaryExpression(statement.expression) &&
      statement.expression.left.getFullText(input).endsWith('___CSS_LOADER_EXPORT___.locals') &&
      ts.isObjectLiteralExpression(statement.expression.right)
  )

  if (locals && locals.expression.right) {
    return locals.expression.right.properties.map(property => property.name.text)
  }

  return []
}

/**
 * Creates CSS definition from list of class names
 */
function createCSSDefinition(tokens) {
  const varibaleDeclaration = ts.createVariableStatement(
    [ts.createToken(ts.SyntaxKind.DeclareKeyword)],
    ts.createVariableDeclarationList(
      [
        ts.createVariableDeclaration(
          'styles',
          ts.createTypeLiteralNode(
            tokens.map(token => {
              return ts.createPropertySignature(
                [ts.createToken(ts.SyntaxKind.ReadonlyKeyword)],
                ts.createStringLiteral(token),
                undefined,
                ts.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
                undefined
              )
            })
          )
        )
      ],
      ts.NodeFlags.Const
    )
  )

  const exportDeclaration = ts.createExportDefault(ts.createIdentifier('styles'))

  return ts.createNodeArray([varibaleDeclaration, exportDeclaration])
}

/**
 * The loader
 */
module.exports = async function (content) {
  this.cacheable(true)

  const url = loaderUtils.interpolateName(this, '[path][name].[ext]', {
    content
  })

  const options = loaderUtils.getOptions(this)
  const callback = this.async()

  try {
    if (!prettierConfig) {
      prettierConfig = await prettier.resolveConfig(options.prettierConfig || __dirname)
    }

    const input = ts.createSourceFile(
      url + '.ts',
      content,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ false,
      ts.ScriptKind.JS
    )

    const localExports = getLocalExports(input)

    if (localExports.length > 0) {
      const outputAST = createCSSDefinition(localExports)
      input.statements = outputAST
      let result = printer.printFile(input)
      result = prettier.format(result, {
        ...prettierConfig,
        parser: 'typescript'
      })
      await fs.promises.writeFile(
        url + '.d.ts',
        '/* eslint-disable */\n// this is an auto-generated file\n' + result,
        'utf8'
      )
    }

    callback(null, content)
  } catch (e) {
    callback(e, content)
  }
}
