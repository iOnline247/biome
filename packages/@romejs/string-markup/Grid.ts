/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */ import {
  ChildNode,
  Children,
  MarkupTagName,
  TagNode,
  TextNode,
} from './types';
import {
  Number1,
  ob1Add,
  ob1Coerce1,
  ob1Dec,
  ob1Get,
  ob1Get1,
  ob1Inc,
  ob1Number1,
} from '@romejs/ob1';
import {formatAnsi} from './ansi';
import {MarkupFormatOptions} from './format';
import {humanizeFileSize, humanizeTime} from '@romejs/string-utils';
import {
  formatApprox,
  formatGrammarNumber,
  formatNumber,
  getFileLinkFilename,
  getFileLinkText,
} from './tagFormatters';
type Cursor = {
  line: Number1;
  column: Number1;
};

function cursorToIndex(
  cursor: Cursor,
): {
  line: number;
  column: number;
} {
  return {
    line: ob1Get1(cursor.line) - 1,
    column: ob1Get1(cursor.column) - 1,
  };
}

type Ancestry = Array<TagNode>;

export default class Grid {
  constructor(opts: MarkupFormatOptions, viewportWidth: undefined | Number1) {
    this.viewportWidth = viewportWidth;
    this.markupOptions = opts;

    this.cursor = {
      line: ob1Number1,
      column: ob1Number1,
    };

    this.canLineWrap = true;
    this.width = ob1Number1;

    this.lines = [];
  }

  canLineWrap: boolean;
  markupOptions: MarkupFormatOptions;
  lines: Array<{
    ranges: Array<{
      start: Number1;
      end: Number1;
      ancestry: Ancestry;
    }>;
    columns: Array<string>;
  }>;
  cursor: Cursor;
  width: Number1;
  viewportWidth: undefined | Number1;

  alignRight() {
    const viewportWidth = ob1Get(this.viewportWidth);
    if (viewportWidth === undefined) {
      return;
    }

    this.lines = this.lines.map(({ranges, columns}) => {
      const newColumns = [...columns];

      // Pad out line to viewport width
      while (newColumns.length < viewportWidth) {
        newColumns.push(' ');
      }

      // Skip if all it contains is spaces

      let onlySpaces = true;
      for (const char of newColumns) {
        if (char !== ' ') {
          onlySpaces = false;
        }
      }
      if (onlySpaces) {
        return {
          columns: newColumns,
          ranges,
        };
      }

      let offset = 0;

      // Shift whitespace from right to left
      while (newColumns[newColumns.length - 1] === ' ') {
        offset++;
        newColumns.pop();
        newColumns.unshift(' ');
      }

      const newRanges = ranges.map((range) => {
        return {
          start: ob1Add(range.start, offset),
          end: ob1Add(range.end, offset),
          ancestry: range.ancestry,
        };
      });

      return {
        ranges: newRanges,
        columns: newColumns,
      };
    });
  }

  doesOverflowViewport(column: Number1): boolean {
    return (
      this.canLineWrap &&
      this.viewportWidth !== undefined &&
      ob1Get1(column) > ob1Get1(this.viewportWidth)
    );
  }

  getHeight(): Number1 {
    return ob1Coerce1(this.lines.length);
  }

  getWidth(): Number1 {
    return this.width;
  }

  getSize(): {
    width: Number1;
    height: Number1;
  } {
    return {
      height: this.getHeight(),
      width: this.getWidth(),
    };
  }

  getCursor(): Cursor {
    return {...this.cursor};
  }

  getLines(): Array<string> {
    return this.lines.map(({columns}) => columns.join(''));
  }

  getFormattedLines(): Array<string> {
    const lines = [];

    for (const {ranges, columns} of this.lines) {
      let content = columns.join('');

      // Sort ranges from last to first
      const sortedRanges = ranges.sort((a, b) => ob1Get1(b.end) - ob1Get1(a.end));

      for (const {start, end, ancestry} of sortedRanges) {
        const startIndex = ob1Get1(start) - 1;
        const endIndex = ob1Get1(end) - 1;

        let substr = content.slice(startIndex, endIndex);

        // Format tags in reverse
        for (let i = ancestry.length - 1; i >= 0; i--) {
          const tag = ancestry[i];
          substr = ansiFormatText(tag, substr, this.markupOptions);
        }

        substr = formatAnsi.reset(substr);

        content =
          content.slice(0, startIndex) + substr + content.slice(endIndex);
      }

      lines.push(content);
    }

    return lines;
  }

  fillCursor(cursor: Cursor) {
    const {line: lineIndex, column: colIndex} = cursorToIndex(cursor);

    // Pad lines
    for (let i = lineIndex; i >= 0 && this.lines[i] === undefined; i--) {
      this.lines[i] = {ranges: [], columns: []};
    }

    // Pad columns
    const line = this.lines[lineIndex];
    for (let i = colIndex - 1; i >= 0 && line.columns[i] === undefined; i--) {
      line.columns[i] = ' ';
    }
  }

  moveCursor(cursor: Cursor) {
    this.fillCursor(cursor);
    this.cursor = cursor;
  }

  moveCursorRight(columns: Number1 = ob1Number1) {
    if (this.doesOverflowViewport(ob1Inc(this.cursor.column))) {
      this.moveCursorDown();
    } else {
      this.moveCursor({
        line: this.cursor.line,
        column: ob1Add(this.cursor.column, columns),
      });
    }
  }

  moveCursorBottom() {
    this.moveCursor({
      line: this.getHeight(),
      column: this.cursor.column,
    });
  }

  moveCursorDown() {
    this.moveCursor({
      line: ob1Inc(this.cursor.line),
      column: ob1Number1,
    });
  }

  writeToCursor(cursor: Cursor, char: string) {
    this.fillCursor(cursor);

    const {line: lineIndex, column: colIndex} = cursorToIndex(cursor);
    this.lines[lineIndex].columns[colIndex] = char;

    if (cursor.column > this.width) {
      this.width = cursor.column;
    }
  }

  writeChar(char: string) {
    if (char === '\n') {
      this.moveCursorDown();
      return;
    }

    this.writeToCursor(this.cursor, char);
    this.moveCursorRight();
  }

  writeText(text: string, ancestry: Ancestry) {
    const start = this.getCursor();

    const words = text.split(' ');

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const isLastWord = i === words.length - 1;

      const willOverflow =
        this.doesOverflowViewport(ob1Add(this.cursor.column, word.length - 1)) &&
        !this.doesOverflowViewport(ob1Coerce1(word.length - 1));
      if (willOverflow) {
        this.moveCursorDown();
      }

      for (const char of word) {
        this.writeChar(char);
      }

      let ignoreLeadingSpace = false;

      // Start of a sentence that was caused by line wrapping
      if (
        !word.endsWith('\n') &&
        this.cursor.column === ob1Number1 &&
        word !== ''
      ) {
        ignoreLeadingSpace = true;
      }

      if (isLastWord) {
        ignoreLeadingSpace = true;
      }

      if (!ignoreLeadingSpace) {
        this.writeChar(' ');
      }
    }

    const end = this.getCursor();
    this.addRange(start, end, ancestry);
  }

  setRange(line: Number1, start: Number1, end: Number1, ancestry: Ancestry) {
    if (start === end) {
      // Nothing to format. Empty tag.
      return;
    }

    this.lines[ob1Get1(line) - 1].ranges.push({
      start,
      end,
      ancestry,
    });
  }

  addRange(start: Cursor, end: Cursor, ancestry: Ancestry) {
    if (start.line === end.line) {
      this.setRange(start.line, start.column, end.column, ancestry);
    } else {
      const width = this.getWidth();

      // Add first line
      this.setRange(start.line, start.column, width, ancestry);

      for (let line = ob1Get1(start.line) + 1; line < ob1Get1(end.line); line++) {
        this.setRange(ob1Coerce1(line), ob1Coerce1(1), width, ancestry);
      }

      // Add last line
      this.setRange(end.line, ob1Number1, end.column, ancestry);
    }
  }

  drawTable(tag: TagNode, ancestry: Ancestry) {
    const rows: Array<Array<TagNode>> = [];

    for (const child of tag.children) {
      if (child.type === 'Tag' && child.name === 'tr') {
        const row: Array<TagNode> = [];

        for (const field of child.children) {
          if (field.type === 'Tag' && field.name === 'td') {
            row.push(field);
          } else {
            // Probably error?
          }
        }

        rows.push(row);
      } else {
        // Probably error?
      }
    }

    // Get the max number of columns for a row
    const columnCount = Math.max(...rows.map((columns) => columns.length));

    // Get column widths
    const columnWidths: Array<number> = [];
    for (let i = 0; i < columnCount; i++) {
      const widths = rows.map((row): number => {
        const field = row[i];
        if (field === undefined) {
          // Could be an excessive column
          return 0;
        } else {
          const grid = new Grid(this.markupOptions, undefined);
          grid.drawTag(field, ancestry);
          return ob1Get1(grid.getSize().width);
        }
      });
      columnWidths[i] = Math.max(...widths);
    }

    // If the column size exceed the stream columns then scale them all down
    const colsNeeded = columnWidths.reduce((a, b) => a + b, 0);
    const {viewportWidth} = this;
    let availableCols =
      viewportWidth === undefined
        ? undefined
        : ob1Get(viewportWidth) - columnCount - 1;
    if (availableCols !== undefined && colsNeeded > availableCols) {
      // Find the biggest column
      let biggestColIndex = 0;
      for (let i = 0; i < columnWidths.length; i++) {
        const ourSize = columnWidths[i];
        const biggestSize = columnWidths[biggestColIndex];

        if (ourSize > biggestSize) {
          biggestColIndex = i;
        }
      }

      // Remove all columns from availableCols
      for (let i = 0; i < columnWidths.length; i++) {
        if (i !== biggestColIndex) {
          availableCols -= columnWidths[i];
        }
      }

      // Set biggest column to the availableCols
      columnWidths[biggestColIndex] = availableCols;
    }

    for (const row of rows) {
      for (let colIndex = 0; colIndex < row.length; colIndex++) {
        const field = row[colIndex];
        const width = ob1Coerce1(columnWidths[colIndex]);

        const grid = new Grid(this.markupOptions, width);
        grid.drawTag(field, ancestry);
        if (field.attributes.align === 'right') {
          grid.alignRight();
        }

        this.drawGrid(grid);
        this.moveCursorRight(ob1Inc(width));
      }

      this.moveCursorBottom();
      this.moveCursorDown();
    }
  }

  drawGrid(grid: Grid) {
    const {lines} = grid;
    const cursor = cursorToIndex(this.cursor);

    // Write
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const {columns, ranges} = lines[lineIndex];

      const correctLine = ob1Coerce1(cursor.line + lineIndex + 1);
      const colOffset = ob1Coerce1(cursor.column);

      for (let colIndex = 0; colIndex < columns.length; colIndex++) {
        const char = columns[colIndex];

        this.writeToCursor(
          {
            line: correctLine,
            column: ob1Add(colOffset, colIndex),
          },
          char,
        );
      }

      const rangeColOffset = ob1Dec(colOffset);
      for (const range of ranges) {
        this.addRange(
          {
            line: correctLine,
            column: ob1Add(rangeColOffset, range.start),
          },
          {
            line: correctLine,
            column: ob1Add(rangeColOffset, range.end),
          },
          range.ancestry,
        );
      }
    }
  }

  drawTag(tag: TagNode, ancestry: Ancestry) {
    const hook = hooks.get(tag.name);

    const subAncestry: Ancestry = [...ancestry, tag];

    const oldCanLineWrap = this.canLineWrap;

    if (tag.name === 'nobr') {
      this.canLineWrap = false;
    }

    if (hook !== undefined && hook.before !== undefined) {
      hook.before(tag, this, ancestry);
    }

    switch (tag.name) {
      case 'table': {
        this.drawTable(tag, subAncestry);
        break;
      }

      default: {
        this.drawChildren(tag.children, subAncestry);
        break;
      }
    }

    if (hook !== undefined && hook.after !== undefined) {
      hook.after(tag, this, ancestry);
    }

    this.canLineWrap = oldCanLineWrap;
  }

  drawChildren(children: Children, ancestry: Ancestry) {
    for (const child of children) {
      if (child.type === 'Text') {
        this.writeText(child.value, ancestry);
      } else {
        this.drawTag(child, ancestry);
      }
    }
  }

  drawRoot(children: Children) {
    this.drawChildren(this.normalizeChildren(children), []);
  }

  normalizeChildren(children: Children): Children {
    let newChildren: Children = [];

    for (const child of children) {
      newChildren = newChildren.concat(this.normalizeChild(child));
    }

    return newChildren;
  }

  normalizeChild(child: ChildNode): Children {
    if (child.type === 'Text') {
      return [child];
    }

    const tag = child;
    const children = this.normalizeChildren(tag.children);
    const textLength = getChildrenTextLength(children);
    const hasText = textLength > 0;

    const {emphasis, ...attributesWithoutEmphasis} = tag.attributes;
    if (emphasis === 'true') {
      return this.normalizeChild({
        type: 'Tag',
        name: 'emphasis',
        attributes: {},
        children: [
          {
            ...tag,
            attributes: attributesWithoutEmphasis,
          },
        ],
      });
    }

    const {dim, ...attributes} = attributesWithoutEmphasis;
    if (dim === 'true') {
      return this.normalizeChild({
        type: 'Tag',
        name: 'dim',
        attributes: {},
        children: [
          {
            ...tag,
            attributes,
          },
        ],
      });
    }

    // Insert padding
    if (tag.name === 'pad') {
      const width = Number(tag.attributes.width) || 0;
      const paddingSize = width - textLength;
      if (paddingSize > 0) {
        const paddingTextNode: TextNode = {
          type: 'Text',
          value: ' '.repeat(paddingSize),
        };
        if (tag.attributes.align === 'right') {
          return [paddingTextNode, ...tag.children];
        } else {
          return [...tag.children, paddingTextNode];
        }
      } else {
        return tag.children;
      }
    }

    // Insert highlight legend
    if (tag.name === 'highlight') {
      const {legend, ...attributesWithoutLegend} = attributes;
      const index = Math.min(0, Number(attributes.i) || 0);
      if (legend === 'true') {
        return [
          {
            ...tag,
            attributes: attributesWithoutLegend,
          },
          {
            type: 'Tag',
            name: 'dim',
            attributes: {},
            children: [
              {
                type: 'Text',
                value: `[${String(index + 1)}]`,
              },
            ],
          },
        ];
      }
    }

    if (hasText) {
      // Wrap hr text in spaces
      if (tag.name === 'hr') {
        return [
          {
            ...tag,
            children: [
              {
                type: 'Text',
                value: ' ',
              },
              ...children,
              {
                type: 'Text',
                value: ' ',
              },
            ],
          },
        ];
      }
    } else {
      if (tag.name === 'filelink') {
        return [
          {
            ...tag,
            children: [
              {
                type: 'Text',
                value: getFileLinkText(
                  getFileLinkFilename(tag.attributes, this.markupOptions),
                  tag.attributes,
                  this.markupOptions,
                ),
              },
            ],
          },
        ];
      }
    }

    // These tags only expect text inside off them
    const singleInnerText =
      children.length === 1 && children[0].type === 'Text'
        ? children[0].value
        : undefined;
    if (singleInnerText !== undefined) {
      switch (tag.name) {
        case 'filesize':
          return [
            {
              type: 'Text',
              value: humanizeFileSize(Number(singleInnerText)),
            },
          ];

        case 'duration':
          return [
            {
              type: 'Text',
              value: formatApprox(
                attributes,
                humanizeTime(Number(singleInnerText), true),
              ),
            },
          ];

        case 'number':
          return [
            {
              type: 'Text',
              value: formatNumber(attributes, singleInnerText),
            },
          ];

        case 'grammarNumber':
          return [
            {
              type: 'Text',
              value: formatGrammarNumber(attributes, singleInnerText),
            },
          ];
      }
    }

    return [
      {
        ...tag,
        children,
      },
    ];
  }
}

function getChildrenTextLength(children: Children): number {
  let length = 0;

  for (const child of children) {
    if (child.type === 'Text') {
      length += child.value.length;
    }

    if (child.type === 'Tag') {
      length += getChildrenTextLength(child.children);
    }
  }

  return length;
}

const hooks: Map<
  MarkupTagName,
  {
    before?: (tag: TagNode, grid: Grid, ancestry: Ancestry) => void;
    after?: (tag: TagNode, grid: Grid, ancestry: Ancestry) => void;
  }
> = new Map();

hooks.set(
  'hr',
  {
    after: (tag, grid, ancestry) => {
      const size =
        grid.viewportWidth === undefined
          ? 100
          : ob1Get1(grid.viewportWidth) - ob1Get1(grid.cursor.column) + 1;
      grid.writeText('\u2501'.repeat(size), ancestry);
    },
  },
);

function ansiFormatText(
  {name: tagName, attributes}: TagNode,
  value: string,
  opts: MarkupFormatOptions,
): string {
  switch (tagName) {
    case 'hyperlink': {
      let text = value;
      let hyperlink = attributes.target;

      if (hyperlink === undefined) {
        hyperlink = text;
      }

      if (text === '') {
        text = hyperlink;
      }

      return formatAnsi.hyperlink(text, hyperlink);
    }

    case 'filelink': {
      const filename = getFileLinkFilename(attributes, opts);
      return formatAnsi.hyperlink(value, `file://${filename}`);
    }

    case 'inverse':
      return formatAnsi.inverse(` ${value} `);

    case 'emphasis':
      return formatAnsi.bold(value);

    case 'dim':
      return formatAnsi.dim(value);

    case 'italic':
      return formatAnsi.italic(value);

    case 'underline':
      return formatAnsi.underline(value);

    case 'strike':
      return formatAnsi.strikethrough(value);

    case 'error':
      return formatAnsi.red(value);

    case 'success':
      return formatAnsi.green(value);

    case 'warn':
      return formatAnsi.yellow(value);

    case 'info':
      return formatAnsi.blue(value);

    case 'command':
      return formatAnsi.italic(value);

    case 'highlight': {
      const index = Math.min(0, Number(attributes.i) || 0);
      const fn = ansiHighlightFactories[index % ansiHighlightFactories.length];
      return fn(value);
    }

    case 'color':
      return formatAnsiBackground(
        attributes.bg,
        formatAnsiForeground(attributes.fg, value),
      );

    default:
      return value;
  }
}

// TODO fill this
const ansiHighlightFactories: Array<(str: string) => string> = [
  formatAnsi.magenta,
  formatAnsi.cyan,
];

function formatAnsiBackground(bg: undefined | string, text: string): string {
  if (bg === undefined) {
    return text;
  }

  switch (bg) {
    case 'black':
      return formatAnsi.bgBlack(text);

    case 'brightBlack':
      return formatAnsi.bgBrightBlack(text);

    case 'red':
      return formatAnsi.bgRed(text);

    case 'brightRed':
      return formatAnsi.bgBrightRed(text);

    case 'green':
      return formatAnsi.bgGreen(text);

    case 'brightGreen':
      return formatAnsi.bgBrightGreen(text);

    case 'yellow':
      return formatAnsi.bgYellow(text);

    case 'brightYellow':
      return formatAnsi.bgBrightYellow(text);

    case 'blue':
      return formatAnsi.bgBlue(text);

    case 'brightBlue':
      return formatAnsi.bgBrightBlue(text);

    case 'magenta':
      return formatAnsi.bgMagenta(text);

    case 'brightMagenta':
      return formatAnsi.bgBrightMagenta(text);

    case 'cyan':
      return formatAnsi.bgCyan(text);

    case 'brightCyan':
      return formatAnsi.bgBrightCyan(text);

    case 'white':
      return formatAnsi.bgWhite(text);

    case 'brightWhite':
      return formatAnsi.bgBrightWhite(text);

    default:
      return text;
  }
}

function formatAnsiForeground(fg: undefined | string, text: string): string {
  if (fg === undefined) {
    return text;
  }

  switch (fg) {
    case 'black':
      return formatAnsi.black(text);

    case 'brightBlack':
      return formatAnsi.brightBlack(text);

    case 'red':
      return formatAnsi.red(text);

    case 'brightRed':
      return formatAnsi.brightRed(text);

    case 'green':
      return formatAnsi.green(text);

    case 'brightGreen':
      return formatAnsi.brightGreen(text);

    case 'yellow':
      return formatAnsi.yellow(text);

    case 'brightYellow':
      return formatAnsi.brightYellow(text);

    case 'blue':
      return formatAnsi.blue(text);

    case 'brightBlue':
      return formatAnsi.brightBlue(text);

    case 'magenta':
      return formatAnsi.magenta(text);

    case 'brightMagenta':
      return formatAnsi.brightMagenta(text);

    case 'cyan':
      return formatAnsi.cyan(text);

    case 'brightCyan':
      return formatAnsi.brightCyan(text);

    case 'white':
      return formatAnsi.white(text);

    case 'brightWhite':
      return formatAnsi.brightWhite(text);

    default:
      return text;
  }
}
