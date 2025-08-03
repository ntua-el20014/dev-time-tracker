const fs = require('fs');
const path = require('path');

function svgToDataUri(svgPath) {
  const absPath = path.resolve(__dirname, "..", "public", svgPath);
  try {
    const svg = fs.readFileSync(absPath, "utf8");
    const base64 = Buffer.from(svg, "utf8").toString("base64");
    return `data:image/svg+xml;base64,${base64}`;
  } catch (error) {
    console.warn(`Warning: Could not read ${svgPath}, using default icon`);
    // Return a simple default icon data URI
    const defaultSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 13A6 6 0 1 1 8 2a6 6 0 0 1 0 12zm-1-6a1 1 0 1 1 2 0 1 1 0 0 1-2 0z"/></svg>';
    const base64 = Buffer.from(defaultSvg, "utf8").toString("base64");
    return `data:image/svg+xml;base64,${base64}`;
  }
}

// Generate data URIs for the icons used in our SQL script
const icons = {
  'vscode.svg': svgToDataUri('icons/vscode.svg'),
  'sublime.svg': svgToDataUri('icons/sublime.svg'),
  'file_type_java.svg': svgToDataUri('icons/file_type_java.svg'),
  'file_type_text.svg': svgToDataUri('icons/file_type_text.svg'),
  'file_type_js.svg': svgToDataUri('icons/file_type_js.svg'),
  'webstorm.svg': svgToDataUri('icons/webstorm.svg'),
  'vim.svg': svgToDataUri('icons/vim.svg'),
  'file_type_css.svg': svgToDataUri('icons/file_type_css.svg')
};

console.log('Generated icon data URIs:');
console.log(JSON.stringify(icons, null, 2));

// Also output them in a format that can be easily copied to SQL
console.log('\n\nFor SQL script:');
Object.entries(icons).forEach(([filename, dataUri]) => {
  console.log(`-- ${filename}`);
  console.log(`'${dataUri}'`);
  console.log('');
});
