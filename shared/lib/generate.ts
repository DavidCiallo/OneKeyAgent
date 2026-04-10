import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const targetName = args[0];

if (!targetName) {
    console.error('Error: eg: npm run gen user name:string age:number');
    process.exit(1);
}

const nameLower = targetName.toLowerCase();
const nameCapitalized = nameLower.charAt(0).toUpperCase() + nameLower.slice(1);

let fields: Record<string, [string, any]> = {};
if (args.length > 1) {
    args.slice(1).forEach(arg => {
        const [key, type] = arg.split(':');
        if (key && type) {
            let defaultValue: any = '""';
            if (type === 'number') defaultValue = 0;
            if (type === 'boolean') defaultValue = false;
            fields[key] = [type, defaultValue];
        }
    });
} else {
    const jsonPath = path.resolve(__dirname, "../json", nameLower + ".json");
    if (fs.existsSync(jsonPath)) {
        fields = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')).fields;
    } else {
        console.error(`Error: 未提供字段且未找到蓝图 ${jsonPath}`);
        process.exit(1);
    }
}

const fieldNames = Object.keys(fields);
const entityFieldsStr = fieldNames.map(k => `${k}: ${fields[k][0]};`).join('\n    ');
const dtoFieldsStr = fieldNames.map(k => `public ${k}: ${fields[k][0]} = ${fields[k][1] === '""' ? '""' : fields[k][1]};`).join('\n    ');
const dtoAssignStr = fieldNames.map(k => `this.${k} = origin.${k};`).join('\n        ');
const updateAssignStr = fieldNames.map(k => `origin.${k} !== undefined && (this.${k} = origin.${k});`).join('\n        ');
const bodyAssignStr = fieldNames.map(k => `origin.${k} !== undefined && (this.${k} = origin.${k});`).join('\n        ');
const pickFieldsStr = fieldNames.map(k => `"${k}"`).join(' | ');

const outputSharedDir = path.resolve(__dirname, '../modules', nameLower);
const outputServerDir = path.resolve(__dirname, '../../server/modules', nameLower);
[outputSharedDir, outputServerDir].forEach(dir => !fs.existsSync(dir) && fs.mkdirSync(dir, { recursive: true }));

const templateDir = path.resolve(__dirname, './template');
const templates = fs.readdirSync(templateDir).filter(file => file.endsWith('.txt'));

templates.forEach(templateFile => {
    let content = fs.readFileSync(path.join(templateDir, templateFile), 'utf-8');
    content = content.replace(/Account/g, nameCapitalized);
    content = content.replace(/account/g, nameLower);
    content = content.replace(/\/\/__ENTITY_FIELDS__\/\//g, entityFieldsStr);
    content = content.replace(/\/\/__DTO_FIELDS__\/\//g, dtoFieldsStr);
    content = content.replace(/\/\/__DTO_ASSIGN__\/\//g, dtoAssignStr);
    content = content.replace(/\/\/__UPDATE_ASSIGN__\/\//g, updateAssignStr);
    content = content.replace(/\/\/__BODY_ASSIGN__\/\//g, bodyAssignStr);
    content = content.replace(/\/\/__PICK_FIELDS__\/\//g, pickFieldsStr);

    const baseName = templateFile.replace('.txt', '');
    const targetDir = baseName.includes('controller') || baseName.includes('service') ? outputServerDir : outputSharedDir;
    const finalPath = path.join(targetDir, `${nameLower}.${baseName}.ts`);

    fs.writeFileSync(finalPath, content);
    console.log(`Generated: ${finalPath}`);
});

console.log(`\n${nameCapitalized} (${fieldNames.join(', ')})`);
