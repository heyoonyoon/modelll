import path from 'node:path';
import { runnerImport } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { APP_NAME } from './src/shared/app.ts';

type HomeStatic = typeof import('./src/client/pages/homeStatic.ts');
type English = typeof import('./src/client/i18n/locales/en.ts');

/** 클라이언트 코드(확장자 없이 가져오는 모듈)를 설정 파일에서 바로 가져오지 않고 vite의 모듈 실행기로 읽는다 */
async function loadHomeStatic(): Promise<{ s: HomeStatic; en: English['en'] }> {
  const options = { configFile: false as const, logLevel: 'error' as const };
  const [{ module: s }, { module: dict }] = await Promise.all([
    runnerImport<HomeStatic>(path.resolve('src/client/pages/homeStatic.ts'), options),
    runnerImport<English>(path.resolve('src/client/i18n/locales/en.ts'), options),
  ]);
  return { s, en: dict.en };
}

const SERVER = process.env.ERD_SERVER ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [
    react(),
    {
      // index.html의 제품 이름 자리를 상수 값으로 채운다
      name: 'app-name',
      transformIndexHtml: (html: string) => html.replaceAll('%APP_NAME%', APP_NAME),
    },
    {
      // 스크립트를 돌리지 않는 로봇이 읽을 제목, 설명, 구조화 데이터와 첫 화면 글을 넣는다(src/client/pages/homeStatic.ts)
      name: 'home-static',
      async transformIndexHtml(html: string) {
        const { s, en } = await loadHomeStatic();
        return html
          .replaceAll('%PAGE_TITLE%', s.PAGE_TITLE)
          .replaceAll('%PAGE_DESCRIPTION%', s.PAGE_DESCRIPTION)
          .replaceAll('%SHARE_DESCRIPTION%', s.SHARE_DESCRIPTION)
          .replace('<!--%STRUCTURED_DATA%-->', () => s.jsonLdScript(s.structuredData(s.PAGE_TITLE, s.PAGE_DESCRIPTION)))
          .replace('<!--%HOME_STATIC%-->', () => s.renderHomeStatic(en));
      },
    },
  ],
  build: { outDir: 'dist/client', emptyOutDir: true },
  server: {
    port: 5180,
    strictPort: true,
    proxy: {
      '/ws': { target: SERVER.replace(/^http/, 'ws'), ws: true },
      '/api': { target: SERVER },
      '/mcp': { target: SERVER },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
