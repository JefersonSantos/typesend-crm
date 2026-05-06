function extractVariables(body) {
  const matches = body.match(/\{\{(\w+)\}\}/g) || [];
  return [...new Set(matches.map((m) => m.slice(2, -2)))];
}

function renderTemplate(body, variableMap, contactData) {
  return body.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
    const column = variableMap[varName];
    if (!column) return match;
    return contactData[column] !== undefined ? String(contactData[column]) : match;
  });
}

module.exports = { extractVariables, renderTemplate };
