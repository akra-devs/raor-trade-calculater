# 라오어 무한매수 주문 계산기 v1

오늘 주문 계산에 집중한 Vite + React + TypeScript 웹앱입니다.

## 범위

- 지원 종목: `TQQQ`, `SOXL` (기본 ETF: `TQQQ`)
- 목표수익률: `TQQQ 15%`, `SOXL 20%` 기본값 적용, 직접 입력 가능
- 지원 분할 수: `20`, `30`, `40` (기본값: `20`)
- 지원 기능: 현재 상태 입력, 잔금/예산 차감 전환형 입력, 총 매수원금/평단 전환형 입력, 오늘 주문 생성 모달, 계산 요약, 경고 표시, 최근 50개 주문 스냅샷 저장, 주문기록 기반 다음 상태 계산
- 가격 데이터: yfinance로 생성한 `public/market-data/*.json` 일봉을 기본 소스로 사용, 화면에서 일봉/주봉/월봉/년봉 집계, TradingView Lightweight Charts 기반 봉차트, MA5/20/60, BB20, RSI14, 전일 기준일 선택 시 해당 종가를 다음 거래일 주문의 전일 종가로 자동 적용
- 제외 기능: 체결 반영, 다음 상태 자동 갱신, 백테스트, 브로커 주문 전송, 시세 API 직접 호출

## 명령

```bash
npm run dev
npm test
npm run build
npm run lint
npm run fetch:market-data
```

## yfinance 일봉 가져오기

`yfinance`는 Python 라이브러리라 브라우저에서 직접 실행하지 않습니다. 먼저 Python 의존성을 설치하고, 로컬 스크립트로 정적 JSON을 만들면 앱이 선택한 종목의 JSON을 자동으로 불러옵니다.

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r scripts/requirements.txt
npm run fetch:market-data
```

생성 파일:

- `public/market-data/TQQQ.json`
- `public/market-data/SOXL.json`

## 구조

- `src/domain/strategy.ts`: UI와 분리된 주문 계산 엔진
- `src/domain/marketData.ts`: 수동 입력 기반 시세 어댑터 인터페이스
- `src/domain/dailyPrices.ts`: yfinance 일봉 데이터 정규화와 지표 계산
- `src/components/CandlestickChart.tsx`: TradingView Lightweight Charts 봉차트
- `scripts/fetch_yfinance_daily.py`: yfinance 일봉 수집 스크립트
- `src/domain/strategy.test.ts`: V4.0 주문 계산 단위 테스트
- `src/App.tsx`: 주문 입력, yfinance 일봉 조회, 주문 결과, localStorage 주문 스냅샷 기록
