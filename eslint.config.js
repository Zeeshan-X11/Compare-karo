const js=require('@eslint/js'),globals=require('globals');
module.exports=[
 {ignores:['node_modules/**','uploads/**','work/**']},
 js.configs.recommended,
 {files:['**/*.js'],languageOptions:{ecmaVersion:2023,sourceType:'commonjs',globals:globals.node},rules:{'no-unused-vars':['error',{argsIgnorePattern:'^_',caughtErrors:'none'}]}},
 {files:['public/**/*.js'],languageOptions:{sourceType:'script',globals:globals.browser}}
];
