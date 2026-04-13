export interface ParsedSummaryCsv {
  fileName: string;
  waferId: string;
  testItems: string[];
  testData: Record<string, string[]>;
}

const DATA_START_ROW_INDEX = 33;

const parseCsvLine = (line: string): string[] => {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  result.push(current.trim());
  return result;
};

const normalizeText = (text: string) => text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

const isDataRow = (row: string[]): boolean => /^\d+$/.test((row[0] ?? "").trim());

const equalIgnoreCase = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

const firstNonEmpty = (values: string[]): string => values.find((value) => value.trim() !== "")?.trim() ?? "";

const waferFromFileName = (fileName: string): string => {
  const nameOnly = fileName.replace(/\.[^/.]+$/, "");
  const parts = nameOnly.split("_").filter(Boolean);
  if (parts.length >= 3) {
    return `${parts[1]}-${parts[2]}`;
  }
  return nameOnly;
};

export const parseSummaryCsv = (content: string, fileName: string): ParsedSummaryCsv => {
  const rows = normalizeText(content)
    .split("\n")
    .map(parseCsvLine);

  const waferMetaRow = rows.find((row) => equalIgnoreCase(row[0] ?? "", "Wafer"));
  const waferMeta = firstNonEmpty(waferMetaRow?.slice(1) ?? []);

  const titleRowIndex = rows.findIndex((row) => equalIgnoreCase(row[0] ?? "", "Title"));
  if (titleRowIndex < 0) {
    throw new Error(`${fileName} 缺少 Title 行，无法识别测试项`);
  }

  const titleRow = rows[titleRowIndex];
  const waferIdCol = titleRow.findIndex((cell) => /^wafer[_\s-]*id$/i.test(cell.trim()));
  if (waferIdCol < 0) {
    throw new Error(`${fileName} 缺少 wafer_ID 列，无法解析`);
  }
  const testTimeCol = titleRow.findIndex((cell) => equalIgnoreCase(cell, "TestTime"));
  const testStartCol = waferIdCol + 1;
  const testEndCol = testTimeCol > testStartCol ? testTimeCol : titleRow.length;

  const indexedTestItems: Array<{ name: string; index: number }> = [];
  for (let col = testStartCol; col < testEndCol; col += 1) {
    const name = (titleRow[col] ?? "").trim();
    if (!name) {
      continue;
    }
    indexedTestItems.push({ name, index: col });
  }
  if (indexedTestItems.length === 0) {
    throw new Error(`${fileName} 未找到可合并的测试项`);
  }

  const dataStartIndexCandidate = rows.findIndex((row, index) => index >= DATA_START_ROW_INDEX && isDataRow(row));
  const dataStartIndex = dataStartIndexCandidate >= 0 ? dataStartIndexCandidate : rows.findIndex(isDataRow);
  if (dataStartIndex < 0) {
    throw new Error(`${fileName} 未找到测试数据行`);
  }

  const testData: Record<string, string[]> = {};
  indexedTestItems.forEach((item) => {
    testData[item.name] = [];
  });

  let waferInData = "";
  for (let rowIndex = dataStartIndex; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!isDataRow(row)) {
      break;
    }
    if (!waferInData) {
      waferInData = (row[waferIdCol] ?? "").trim();
    }
    indexedTestItems.forEach((item) => {
      testData[item.name].push((row[item.index] ?? "").trim());
    });
  }

  return {
    fileName,
    waferId: waferMeta || waferInData || waferFromFileName(fileName),
    testItems: indexedTestItems.map((item) => item.name),
    testData,
  };
};

