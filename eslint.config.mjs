import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

/**
 * `npm run lint` は長いあいだ動いていなかった。
 * `next lint` を指していたが、その仕組みは Next から無くなり、
 * そもそも ESLint の設定も入っていなかった。
 */
export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,

  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // 生成物。人が書く場所ではない。
    'public/pose/**',
    '.data/**',
  ]),

  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          // このコードベースは前から「使わない引数は _ で始める」で書いてある。
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          // `const { what, ...rest } = init` のように、
          // **外すために取り出す**書き方を、未使用と呼ばない。
          ignoreRestSiblings: true,
        },
      ],

      /**
       * React Compiler が新しく入れた3つ。**消さずに警告で残す。**
       *
       * 指しているのはたとえば「描かれた後でないと localStorage は読めない」
       * という書き方で、SSR のある画面では意図してそうしている。
       * 直すなら useSyncExternalStore への置き換えになるが、
       * それは動いている画面9枚の作り直しで、lint を直す作業とは別のもの。
       *
       * **ここを消すと、次に本当の間違いが入った時に気づけない。** 見える形で残す。
       */
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
    },
  },
]);
