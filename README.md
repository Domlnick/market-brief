# 모닝 마켓 브리프

매일 아침 7:30(KST) 자동 발행되는 증시 브리핑 블로그. https://domlnick.github.io/market-brief/

## 구조

```
content/posts/YYYY-MM-DD.md     글 (frontmatter: title, date, type, summary, tags, highlights)
data/snapshots/YYYY-MM-DD.json  그날의 시장 데이터 (대시보드/스파크라인 렌더링용)
scripts/collect.mjs             네이버 증권·업비트에서 데이터 수집
scripts/build.mjs               정적 사이트 생성 (dist/)
scripts/publish.mjs             GitHub API로 커밋 (git CLI 불필요)
.github/workflows/deploy.yml    push 시 빌드 후 GitHub Pages 배포
```

## 명령어

```bash
npm run collect          # 오늘 데이터 수집
npm run preview          # http://localhost:4321 미리보기
npm run publish -- "msg" # 변경분 커밋 → Actions가 자동 배포
```

## 발행 규칙

- 화~토: `type: daily` 모닝 브리프 (미국 마감 + 국내 전일 + 매크로 + 체크포인트)
- 월: `type: weekly` 주간 프리뷰
- 일: 발행 없음

색상은 국내 관례(상승 빨강, 하락 파랑). 모든 글 하단에 면책 문구 자동 삽입.
