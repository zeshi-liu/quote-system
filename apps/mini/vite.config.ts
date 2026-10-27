import { defineConfig } from 'vite';
import uni from '@dcloudio/vite-plugin-uni';
export default defineConfig({
 plugins: [uni()],
 // 工作区共享 TypeScript 直接参与开发编译，避免预构建缓存遗漏新增导出。
 optimizeDeps: { exclude: ['@quote/archive-client', '@quote/receivables-client'] },
 server: { proxy: { '/api': 'http://127.0.0.1:3000' } },
});
