const path = require('path')
const srcDir = path.resolve(__dirname, '../src')

const jiti = require('jiti')(__filename, {
  alias: {
    '@': srcDir,
  },
})

jiti(path.join(__dirname, 'test-suite.ts'))
