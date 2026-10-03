# 내 서재 (개인용 EPUB 리더)

빌드 과정이 없는 정적 사이트입니다. 이 폴더의 내용을 그대로 GitHub Pages에 올리면 됩니다.

## GitHub Pages 배포
1. GitHub에서 새 저장소를 만듭니다. (예: `my-reader`)
2. zip을 풀어서 **안의 파일들**(index.html, app.js, lib/ 등)을 저장소 맨 위에 올립니다. (폴더째 올리면 주소가 달라집니다)
3. 저장소 Settings → Pages → Source: `Deploy from a branch`, Branch: `main` / `(root)` → Save
4. 1~2분 뒤 `https://<아이디>.github.io/my-reader/` 로 접속됩니다.

## 아이패드에서 쓰기
Safari로 접속 → 공유 버튼 → **홈 화면에 추가**. 전체 화면 앱처럼 열리고 오프라인에서도 실행됩니다.

## 알아둘 점
- 책 파일, 읽던 위치, 북마크, 메모는 **쓰는 기기의 브라우저(IndexedDB)에만** 저장됩니다. GitHub나 서버에는 올라가지 않으므로 사이트 주소가 공개돼도 책은 보이지 않습니다.
- 다른 기기에서 읽으려면 그 기기에서도 책을 따로 추가해야 합니다.
- 서재의 "백업"으로 북마크·메모·진행도를 JSON으로 저장/복원할 수 있습니다. (책 파일은 포함되지 않음)
- 코드를 수정해서 다시 올린 뒤 화면이 그대로면 `sw.js`의 `const V = 'reader-v1'` 숫자를 올려주세요.
- epub 처리에는 epub.js 와 JSZip(lib/ 폴더, 오픈소스)을 사용합니다.
