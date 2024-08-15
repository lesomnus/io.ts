import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
	{
		extends: './vite.config.ts',
		test: {
			globals: true,
			environment: 'node',
		},
	},
	{
		extends: './vite.config.ts',
		test: {
			globals: true,
			environment: 'jsdom',
		},
	},
])
