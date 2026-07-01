/**
 * Serialize a value as a JSON string safe to inject into a `<script>` element
 * via `set:html`. `JSON.stringify` does NOT escape `<`, `>`, `&`, or the line
 * separators U+2028/U+2029, so a field value containing `</script>` (e.g. a
 * malicious `github` URL in the YAML data) would close the script element and
 * inject arbitrary HTML — stored XSS. Escaping those characters as `\uXXXX`
 * keeps the JSON valid and inert regardless of the field's contents.
 */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
