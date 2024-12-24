export const normalizeSQLDefinition = (definition) => {
    return definition
        .replace(/\s+/g, ' ') // Replace multiple whitespace with a single space
        .replace(/'/g, "\\'") // Escape single quotes
        .trim(); // Trim leading and trailing whitespace
}