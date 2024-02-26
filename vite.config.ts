import { readFile } from 'node:fs/promises'
import path from 'node:path'

import typescript from '@rollup/plugin-typescript'
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

				return `export default new Uint8Array([${new Uint8Array(
					await readFile(id.slice(0, -b.length)),
				)}])`
			},
		},
	],
	build: {
		sourcemap: true,
		minify: false,
		lib: {
			entry: path.resolve(__dirname, 'src/index.ts'),
			fileName: 'index',
			formats: ['es', 'cjs'],
		},
		rollupOptions: {
			external: [],
			plugins: [
				typescript({
					// sourceMap: true,
					exclude: ['**.test.ts'],
				}),
			],
		},
	},
	test: {
		environment: 'jsdom',
		include: ['src/**/*.test.ts'],
		exclude: [...defaultExclude, '**/*.suite.test.ts'],
		coverage: {
			enabled: true,
			provider: 'v8',
			reporter: ['html'],
		},
	},
})
