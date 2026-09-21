## Zip Slip脆弱性

### この節のねらい

ファイルアップロードの受け口として「ZIP / TAR などの圧縮アーカイブを受け取り、サーバ側で展開する」機能は非常に多い。プラグインの導入、テーマの取り込み、バックアップの復元、Dockerイメージやパッケージの取り扱いなど、用途は幅広い。ところが、アーカイブの「展開（extract / unzip）」処理は、実装者が思っている以上に危険な操作である。

**Zip Slip（ジップ・スリップ）** は、悪意あるアーカイブに含まれるエントリ名（アーカイブ内のファイルのパス）に `../` のようなディレクトリトラバーサル（親ディレクトリへ遡る相対パス）を仕込むことで、**本来の展開先ディレクトリの外へ任意のファイルを書き込ませる**脆弱性である。書き込み先を実行可能ファイルや設定ファイルに向ければ、最終的に**リモートコード実行（RCE: 攻撃者の任意コマンドをサーバ上で走らせること）**に発展しうる、極めて影響の大きい欠陥だ。

セキュリティ企業 Snyk が 2018年6月5日 に「Zip Slip」という名前を付けて公開し、Oracle、Amazon、Spring/Pivotal、LinkedIn、Twitter、Alibaba、Jenkins、Eclipse、OWASP、SonarQube、Google など、数千のプロジェクト・ライブラリに影響することが判明した。本節では、なぜこの脆弱性が「展開処理の仕組み」から必然的に生まれるのかを、パス結合の内部挙動レベルで解き明かし、防御コードの原理まで踏み込む。

> 本テキストは防御目的で記述する。実在サービスや本番環境への無許可の検証、破壊的手順は扱わない。以下のコードは、自分が管理する検証環境で脆弱性の原理と修正を理解するための最小例である。

---

### Zip Slipとは何か

まず用語を整理する。

- **アーカイブ**: 複数のファイルを1つにまとめた入れ物。ZIP、TAR、JAR、WAR、CPIO、APK、RAR、7z などが該当する。それぞれの内部には「エントリ（entry）」が並び、各エントリは**エントリ名（＝そのファイルの相対パス）**と中身のデータを持つ。
- **エントリ名**: 例えば `docs/readme.txt` のような、展開時にどのパスへ書き出すかを示す文字列。ここが攻撃の入口になる。

Zip Slip の本質は次の一言に集約される。

> **アーカイブのエントリ名を、展開先ディレクトリのパスと素朴に連結し、連結結果をそのまま書き込み先として使ってしまう。**

エントリ名に `../../../../tmp/evil.sh` のような値が入っていると、連結結果は展開先の外を指す。攻撃者はアーカイブを作る側なので、エントリ名は完全に攻撃者の制御下にある。つまりこれは**「攻撃者が完全に制御する入力（エントリ名）が、ファイルの書き込み先という危険な代入先（sink: 入力が最終的に実行・解釈される到達点）に、検証なしで流れ込む」**という、典型的なインジェクション構造である。

Snyk の分類では、これは **arbitrary file overwrite（任意ファイル上書き）** に分類される critical 級の脆弱性であり、「典型的に RCE へつながる」とされている。

> 出典: Zip Slip Vulnerability — Snyk Research — https://security.snyk.io/research/zip-slip-vulnerability

---

### なぜ起きるのか：パス連結の内部挙動

Zip Slip は「ライブラリの珍しいバグ」ではなく、**パス連結という基本APIの素直な仕様**から生まれる。ここが理解の核心なので、仕組みレベルで丁寧に見る。

#### Javaの `new File(dir, name)` の挙動

Java の代表的な脆弱パターンは次のとおりである（Snyk の解説より）。

```java
Enumeration<ZipEntry> entries = zip.getEntries();
while (entries.hasMoreElements()) {
   ZipEntry e = entries.nextElement();
   File f = new File(destinationDir, e.getName());   // ★ここが問題
   InputStream input = zip.getInputStream(e);
   IOUtils.copy(input, write(f));                     // fへ書き込み
}
```

問題は `new File(destinationDir, e.getName())` の一行だ。`java.io.File` の「親ディレクトリ + 子パス」コンストラクタは、単に文字列としてパスを連結し、`File` オブジェクトを作るだけである。**このコンストラクタは相対パスの `..` を解決（正規化）しない**。つまり `..` が入っていても弾かず、警告もしない。

具体的に、`destinationDir` が `/var/app/uploads/unzip` で、エントリ名が `../../../../../../tmp/evil.sh` の場合を考える。

```
連結直後（未正規化）: /var/app/uploads/unzip/../../../../../../tmp/evil.sh
```

この文字列を実際にファイルシステムがオープンするとき、OS はパス中の `..` を「1つ上のディレクトリ」として解釈する。`..` を6段遡ると `/var/app/uploads/unzip` を突き抜けてルート付近まで戻り、最終的な実体パスは次のようになる。

```
実際に書き込まれる場所: /tmp/evil.sh
```

つまり、`FileOutputStream` などで書き込む段階で OS がパスを解決した結果、**展開先ディレクトリの完全に外側**にファイルが作られる。`new File` のコンストラクタは何も検証しないため、開発者は「`destinationDir` の下に書いている」と思い込んでいるのに、実際にはどこへでも書けてしまう。これが Zip Slip の一次原理である。

Snyk の技術白書に載る、より低レベルの脆弱コードでも同じ構造が現れる。

```java
ZipInputStream zis = new ZipInputStream(new FileInputStream("archive.zip"));
ZipEntry entry;
while ((entry = zis.getNextEntry()) != null) {
    String entryName = entry.getName();
    File file = new File(destination, entryName);  // 検証なしの連結
    FileOutputStream fos = new FileOutputStream(file); // 展開先の外へ書ける
}
```

> 出典: Zip Slip — Technical Whitepaper (PDF) — Snyk — https://res.cloudinary.com/snyk/image/upload/v1528192501/zip-slip-vulnerability/technical-whitepaper.pdf

#### なぜ「絶対パス」も危険なのか

`..` による相対トラバーサルだけでなく、**エントリ名が絶対パス**（例: `/etc/cron.d/backdoor` や Windows の `C:\Windows\...`）である場合も危険だ。多くの言語のパス結合APIは、「2番目の引数が絶対パスなら1番目を無視して2番目を採用する」という仕様を持つ。例えば Node.js の `path.join('/dest', '/etc/passwd')` は `/etc/passwd` を返さないが、`path.resolve('/dest', '/etc/passwd')` は `/etc/passwd` を返す。実装によっては絶対パスがそのまま採用され、展開先が完全に無視される。したがって防御では「`..` を含むか」だけでなく「絶対パスでないか」も考慮する必要がある。

#### 攻撃の二段構え

Snyk は Zip Slip を「2つの要素が組み合わさって成立する」と説明する。

1. **悪意あるアーカイブの作成**: 攻撃者が、トラバーサル入りのエントリ名を持つアーカイブを用意する。通常のZIPツールは `..` 入りの名前を作りにくいので、攻撃者は生のAPIやスクリプトでアーカイブを直接生成する。
2. **検証を欠いた展開コード**: 受け取り側が、エントリ名を正規化・検証せずに書き込み先へ使う。

このどちらか一方でも欠ければ攻撃は成立しない。逆に言えば、**展開側で正しく検証すれば防げる**——修正の責任は基本的に「アーカイブを展開する側」にある。

なお、白書ではトラバーサルに加えて**シンボリックリンク（symlink）を使う変種**にも触れている。アーカイブ内に「外部を指すsymlink」を含め、その後に「そのsymlink経由のパス」へ書き込むエントリを置くことで、正規化チェックをすり抜けて外部へ書く手法である。防御でパスを解決する際に「symlinkを辿った後の実体パス」で判定すべき理由がここにある（Javaの `getCanonicalPath()` は symlink を解決する点が重要）。

---

### 影響を受けるアーカイブ形式とエコシステム

Zip Slip は ZIP に限らない。エントリ名という概念を持つアーカイブ全般に及ぶ。

- **対象形式**: tar, jar, war, cpio, apk, rar, 7z（そして最も一般的な zip）。
- **最も影響が大きい言語**: Java。理由は、Javaには「アーカイブ展開を安全に一元処理する標準の高水準ライブラリ」が存在せず、各プロジェクトが `java.util.zip` や `commons-compress` を使って**手書きの展開ループ**を書くため。Stack Overflow などに出回った脆弱なスニペットがコピーされ、被害が拡散した。
- **他に影響**: JavaScript、.NET、Go、Ruby など。

Snyk の GitHub リポジトリ（`snyk/zip-slip-vulnerability`）には、影響ライブラリと修正状況が整理されている。主なものを挙げる（2018年公開時点、CVE付きで修正済みのもの）。

| 言語 | ライブラリ | 修正バージョン | CVE |
|------|-----------|---------------|-----|
| JavaScript | unzipper | 0.8.13 | CVE-2018-1002203 |
| JavaScript | adm-zip | 0.4.9 | CVE-2018-1002204 |
| Java | plexus-archiver | 3.6.0 | CVE-2018-1002200 |
| Java | zt-zip | 1.13 | CVE-2018-1002201 |
| Java | zip4j | 1.3.3 | CVE-2018-1002202 |
| .NET | DotNetZip.Semverd | 1.11.0 | CVE-2018-1002205 |
| .NET | SharpCompress | 0.21.0 | CVE-2018-1002206 |
| .NET | SharpZipLib | 1.0.0 | CVE-2018-1002208 |
| C++/Qt | quazip | 0.7.6 | CVE-2018-1002209 |
| PHP | chumper/zipper | 1.0.3 | N/A |
| Ruby | rubyzip | （最新へ） | CVE-2018-1000544 |

重要な注意点として、**「高水準APIが無く、脆弱なパターンが利用者側に残り続ける」もの**がある。これらはライブラリ自体を直せば済むのではなく、**使う側が毎回自分で検証を書かねばならない**。

- Java: `java.util.zip`, `commons-compress`
- Go: 標準の `archive` パッケージ（`archive/zip`, `archive/tar`）
- Ruby: zip-ruby, zipruby
- Python: `tarfile`（後述のとおり後年に既定挙動が強化された）
- Rust: rs-async-zip

また Go のいくつかのライブラリ（cae/zip: CVE-2020-7664、cae/tz: CVE-2020-7668）は、公開後しばらく未修正のまま残っていた点も記録されている。

> 出典: snyk/zip-slip-vulnerability — GitHub — https://github.com/snyk/zip-slip-vulnerability

---

### 攻撃が成立するとどうなるか

任意の場所へファイルを書けると、攻撃者は多様な悪用ができる。

- **実行ファイルの上書きによるRCE**: 起動スクリプト、cronジョブ（`/etc/cron.d/`）、Webアプリのデプロイ先（`.jsp`/`.php`/`.aspx` など）、`~/.bashrc`、systemdユニットなどを上書き・設置し、後で実行させることで任意コマンド実行に至る。
- **設定ファイルの破壊・改ざん**: 認証設定や許可リストを書き換え、権限昇格やバイパスにつなげる。
- **クライアント側の被害**: サーバだけでなく、ユーザーの端末でアーカイブを展開するデスクトップアプリやビルドツールでも成立し、ローカルファイルを汚染しうる。

要は「どこへでも1バイト書ける」時点で、環境次第でRCEまで一直線になりうる。だからこそ Snyk は critical と位置づけた。

---

### 防御：正規化してから境界内かを検証する

修正の原理はシンプルで、言語を問わず共通である。

> **エントリ名を展開先と連結したら、その結果を「正規化（canonicalize）」し、正規化後のパスが「展開先ディレクトリの内側」に収まっていることを、書き込みの前に必ず確認する。収まっていなければ拒否する。**

「正規化」とは、`..` や `.`、symlink を解決して、そのパスが実際に指す一意な絶対パス（**canonical path**）を求めることである。正規化してから比較しないと、`../` を含んだままの文字列比較になり、判定が破られる。

#### Javaの安全な実装（Snyk推奨パターン）

Snyk が推奨する定番の修正は、エントリごとに「安全な `File` を返すヘルパー」を挟む方法だ。

```java
public File newFile(File destinationDir, ZipEntry zipEntry) throws IOException {
    File destFile = new File(destinationDir, zipEntry.getName());

    String destDirPath  = destinationDir.getCanonicalPath(); // 展開先の正規パス
    String destFilePath = destFile.getCanonicalPath();       // 書き込み先の正規パス（..やsymlink解決後）

    // 「展開先パス + セパレータ」で始まっていなければ、外へ出ている＝拒否
    if (!destFilePath.startsWith(destDirPath + File.separator)) {
        throw new IOException("Entry is outside of the target dir: " + zipEntry.getName());
    }
    return destFile;
}
```

**なぜこれで防げるのか**を分解する。

1. `getCanonicalPath()` は `..`・`.`・シンボリックリンクをすべて解決し、その `File` が最終的に指す実体の絶対パスを返す。したがって `../../../../tmp/evil.sh` は `/tmp/evil.sh` に、symlink 経由の細工も辿った先の実体に化ける。**検証対象を「見かけの文字列」ではなく「実際に書かれる場所」に揃える**のがポイント。
2. その実体パスが `destDirPath + File.separator`（例: `/var/app/uploads/unzip/`）で始まるかを確認する。始まっていれば展開先の内側、始まっていなければ外側だ。外側なら例外を投げて展開を中止する。
3. **`File.separator` を付けて比較する理由**が重要だ。もし単に `destDirPath` で `startsWith` すると、`/var/app/uploads/unzip` という展開先に対し `/var/app/uploads/unzip-evil/...` のような**兄弟ディレクトリ**が「前方一致」してしまい、すり抜ける（プレフィックス誤判定）。末尾にセパレータを付けることで「このディレクトリの直下（配下）」だけを許可でき、名前が似た隣接ディレクトリを弾ける。

この `newFile()` を展開ループから呼び、返ってきた `File` にだけ書き込むようにすれば安全になる。

```java
File destDir = new File(destination).getCanonicalFile();
ZipEntry entry;
while ((entry = zis.getNextEntry()) != null) {
    File target = newFile(destDir, entry);   // 検証込み。外を指すなら例外で中断
    // entry がディレクトリなら mkdirs、ファイルなら親を作ってから書き込む
    // ...target へ安全に書き出す...
}
```

> 出典: Zip Slip — Technical Whitepaper (PDF) — Snyk — https://res.cloudinary.com/snyk/image/upload/v1528192501/zip-slip-vulnerability/technical-whitepaper.pdf

#### 他言語での同じ原理

言語が変わっても「正規化 → 境界内チェック」という骨格は同じである。以下は原理を示す最小例で、実運用ではセパレータ境界の扱い（前項の `File.separator` 相当）を必ず入れること。

**Node.js / JavaScript**

```javascript
const path = require('path');

const destResolved = path.resolve(destination);
const resolvedPath = path.resolve(destination, entry.name);

// 「展開先 + パス区切り」で始まるか、または展開先そのものかを確認
if (resolvedPath !== destResolved &&
    !resolvedPath.startsWith(destResolved + path.sep)) {
    throw new Error('Path traversal detected: ' + entry.name);
}
```

`path.resolve()` は絶対パス化と `..` の解決を行う。前述のとおり、エントリ名が絶対パスなら `path.resolve` はそれを採用してしまうため、この検証で `destResolved` 配下に収まらず弾かれる——絶対パス攻撃にも効く点が利点だ。

**Go**

```go
destAbs, _ := filepath.Abs(destination)
entryPath := filepath.Join(destination, entry.Name) // Joinは..をCleanで正規化する
absPath, _ := filepath.Abs(entryPath)

if absPath != destAbs &&
    !strings.HasPrefix(absPath, destAbs+string(os.PathSeparator)) {
    // 展開先の外 → 拒否
}
```

Go の `filepath.Join` は内部で `filepath.Clean` を呼び `..` を畳み込むが、それでも「畳み込んだ結果が外を指す」ケースがあるため、**Abs化した上での前方一致チェックは必須**である。

**.NET**

```csharp
string fullDestination = Path.GetFullPath(destination);
string fullPath = Path.GetFullPath(Path.Combine(destination, entry.Name));

if (!fullPath.StartsWith(
        fullDestination.EndsWith(Path.DirectorySeparatorChar.ToString())
            ? fullDestination
            : fullDestination + Path.DirectorySeparatorChar)) {
    throw new Exception("Path traversal detected");
}
```

`Path.GetFullPath` が正規化を担う。ここでもディレクトリ区切りを付けた前方一致にするのが、兄弟ディレクトリ誤判定を防ぐ要点だ。

#### Python `tarfile` の注意とバージョン事情

Python の `tarfile` は歴史的に Zip Slip に相当する挙動（`extractall` がトラバーサルや絶対パスを検証しない）を持ち、長らく利用者側の対策が必要だった（この問題は CVE-2007-4559 として古くから知られていた）。**Python 3.12 以降**では `tarfile.extractall()` / `extract()` に `filter` 引数が追加され、`filter='data'` を指定すると、絶対パスや `..` を含む危険なエントリを拒否する安全なフィルタが適用される。将来的には安全側がデフォルトになる方針が示されている。したがって新しいコードでは次のように明示する。

```python
import tarfile

with tarfile.open("archive.tar") as tar:
    tar.extractall(path=destination, filter="data")  # 危険なメンバーを拒否
```

古い Python では `filter` が使えないため、各メンバーについて自前で正規化・境界チェックを行う必要がある。

> ⚠️ **バージョン依存の注意**: 上記の `tarfile` の `filter` は Python 3.12（2023年）で導入された挙動である。対象環境のバージョンによって既定の安全性が異なるため、実装時は必ずランタイムのバージョンと当該ライブラリの現行仕様を確認すること。

---

### 実装時のチェックリスト（防御のまとめ）

Zip Slip を確実に潰すための実務ポイントを整理する。

1. **正規化してから検証する**: 見かけの文字列でなく、`..`・`.`・symlink を解決した canonical / absolute path で判定する（Javaは `getCanonicalPath()`、Nodeは `path.resolve`、.NETは `Path.GetFullPath`、Goは `filepath.Abs`）。
2. **ディレクトリ区切りを付けた前方一致**: `destDir + separator` で始まるかを確認し、名前が似た兄弟ディレクトリのすり抜けを防ぐ。
3. **絶対パスも拒否**: エントリ名が絶対パスのケースを検証で確実に弾く（正規化＋境界チェックで自然に弾ける）。
4. **symlinkエントリを警戒**: symlink を含むアーカイブは、その後の書き込みが外部を指しうる。信頼できない入力では symlink エントリ自体を拒否するのが安全。
5. **書き込み前に中断**: 検証で外部を指すと判明したら、そのエントリだけ飛ばすのでなく展開全体を中止する設計が堅い（悪意あるアーカイブと判断できるため）。
6. **メンテされたライブラリの最新版を使う**: 前掲の修正済みバージョン以上を使う。ただし「高水準APIが無いエコシステム（`java.util.zip`, Go `archive`, 旧Python `tarfile` など）」では、ライブラリ更新だけでは守れず、上記の検証を自分で必ず書く。
7. **最小権限で展開する**: 展開プロセスの権限・書き込み可能範囲を絞り、万一のトラバーサルでも重要ファイルへ届かないよう多層防御する（chroot / コンテナ / 専用の書き込み専用ディレクトリなど）。
8. **付随する対策**: Zip Slip とは別だが、アーカイブ展開では「展開後の総サイズ・ファイル数の上限」も設けること（いわゆる zip bomb 対策）。トラバーサル検証とは独立に必要な防御である。

---

### まとめ

- Zip Slip は、**アーカイブのエントリ名（攻撃者が完全に制御できる入力）を、展開先パスと素朴に連結し、検証せず書き込み先に使う**ことで起きる、任意ファイル上書き脆弱性である。
- 根本原因は `new File(dir, name)` / `path.join` などの**パス連結APIが `..` を解決も検証もしない**という素直な仕様にあり、OSがパス解決する段階で展開先の外へ抜け出す。RCEに直結しうる critical 級。
- 2018年に Snyk が命名・公開し、tar/jar/war など幅広い形式、Java・JS・.NET・Go・Ruby など多数のエコシステムの数千プロジェクトに影響した。特に「安全な高水準APIが無い」環境では、利用者側にパターンが残り続ける。
- 防御の原理は普遍で、**「正規化してから、展開先ディレクトリ配下（区切り文字境界込み）に収まるかを、書き込み前に検証し、外なら拒否する」**。これを言語ごとの正規化API（`getCanonicalPath` / `path.resolve` / `Path.GetFullPath` / `filepath.Abs`）で実装する。Python 3.12+ の `tarfile` は `filter="data"` で安全側にできる。
