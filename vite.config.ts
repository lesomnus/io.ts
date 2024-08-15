import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import dts from 'vite-plugin-dts'
import { defaultExclude, defineConfig } from 'vitest/config'

export default defineConfig({
	plugins: [
		{
			name: 'bytes',
			async transform(_, id) {
				const b = '?bytes'
				if (!id.endsWith(b)) {
					return
				}

				const data = await readFile(id.slice(0, -b.length))
				return `export default new Uint8Array([${new Uint8Array(data)}])`
			},
		},
		dts({
			exclude: ['vite.config.ts', '**/*.test.ts', 'src/testdata'],
		}),
	],
	build: {
		minify: false,
		lib: {
			entry: {
				main: resolve(import.meta.dirname, 'src/index.ts'),
			},
			formats: ['es', 'cjs'],
		},
	},
	server: {
		host: '0.0.0.0',
	},
	test: {
		exclude: [...defaultExclude, '**/*.suite.test.ts'],
		coverage: {
			enabled: true,
			provider: 'istanbul',
			reporter: ['html', 'lcov'],
		},
	},
})
