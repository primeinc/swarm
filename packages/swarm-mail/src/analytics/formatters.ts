/**
 * Analytics Query Result Formatters
 *
 * Output formatters for query results in various formats.
 * Each formatter takes a QueryResult and returns a string.
 */

import type { QueryResult } from "./types.js";

/**
 * Format query result as ASCII table with aligned columns.
 *
 * Produces a readable table format with headers, separators, and aligned columns.
 * Empty results show headers and indicate 0 rows.
 *
 * @param result - Query result to format
 * @returns ASCII table string
 */
export function formatTable(result: QueryResult): string {
	const { columns, rows, rowCount } = result;

	if (columns.length === 0) {
		return "No columns to display\n(0 rows)\n";
	}

	// Calculate column widths (max of header and all cell values)
	const widths: number[] = columns.map((col) => col.length);

	for (const row of rows) {
		columns.forEach((col, i) => {
			const value = String(row[col] ?? "");
			widths[i] = Math.max(widths[i], value.length);
		});
	}

	// Build header row
	const headerRow = columns.map((col, i) => col.padEnd(widths[i])).join(" | ");

	// Build separator row
	const separator = widths.map((w) => "-".repeat(w)).join("-+-");

	// Build data rows
	const dataRows = rows.map((row) =>
		columns
			.map((col, i) => String(row[col] ?? "").padEnd(widths[i]))
			.join(" | "),
	);

	// Assemble final output
	const lines = [headerRow, separator, ...dataRows];

	if (rowCount === 0) {
		lines.push(`(0 rows)`);
	} else {
		lines.push(`(${rowCount} rows)`);
	}

	return `${lines.join("\n")}\n`;
}

/**
 * Format query result as pretty-printed JSON.
 *
 * Produces a readable JSON representation of the entire QueryResult object.
 *
 * @param result - Query result to format
 * @returns Pretty-printed JSON string
 */
export function formatJSON(result: QueryResult): string {
	return JSON.stringify(result, null, 2);
}

/**
 * Format query result as RFC 4180 compliant CSV.
 *
 * Produces CSV with:
 * - Header row with column names
 * - Data rows with values
 * - Proper escaping of quotes and commas
 * - Empty strings for null/undefined values
 *
 * @param result - Query result to format
 * @returns CSV string
 */
export function formatCSV(result: QueryResult): string {
	const { columns, rows } = result;

	// Header row
	const headerRow = columns.join(",");

	// Data rows with RFC 4180 escaping
	const dataRows = rows.map((row) =>
		columns
			.map((col) => {
				const value = row[col];

				// Handle null/undefined as empty string
				if (value == null) {
					return "";
				}

				const str = String(value);

				// If contains comma, quote, or newline, quote and escape
				if (str.includes(",") || str.includes('"') || str.includes("\n")) {
					return `"${str.replace(/"/g, '""')}"`;
				}

				return str;
			})
			.join(","),
	);

	return `${[headerRow, ...dataRows].join("\n")}\n`;
}

/**
 * Format query result as newline-delimited JSON (JSONL).
 *
 * Produces one compact JSON object per line, one line per row.
 * Empty results produce empty string.
 *
 * @param result - Query result to format
 * @returns JSONL string (newline-delimited JSON objects)
 */
export function formatJSONL(result: QueryResult): string {
	const { rows } = result;

	if (rows.length === 0) {
		return "";
	}

	return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}
