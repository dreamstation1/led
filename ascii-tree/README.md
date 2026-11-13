# ASCII Christmas Tree 🎄

글자로 그린 3D 크리스마스 트리가 빙글빙글 돌아가는 파이썬 애니메이션.

```
pip install pygame numpy
python christmas_tree.py
```

- 반짝이는 전구, 장식 공, 꼭대기 별, 내리는 눈, 달, 별똥별
- 트리를 감고 흘러가는 빨강·금색 리본 2줄, 별 아래 리본 매듭과 날리는 꼬리
- 순록 3마리가 끄는 산타 썰매가 하늘을 가로지름 (HO HO HO!, 반짝이 꼬리)
- 손 흔드는 눈사람, 들썩이는 선물 상자
- `MERRY CHRISTMAS` 글자가 한 글자씩 나타남
- 조작: `Space` 일시정지 · `R` 다시 시작 · `S` 스크린샷 · `Esc` 종료
- 문구는 `christmas_tree.py`의 `MESSAGE` 값을 바꾸면 됨

## 웹 버전 (`index.html`, 폰에서 바로 실행)

파이썬 버전의 모든 것 + 아래 기능
- 산타가 지나가며 선물을 떨어뜨리고, 선물이 바닥·큰 상자 위에 쌓임
- 캐롤 3곡 (Jingle Bells · We Wish You a Merry Christmas · Silent Night, 오르골 소리) + 썰매 방울
- 트리 가지 끝과 땅에 눈이 점점 쌓임, 트리를 누르면 흔들리며 눈이 털림
- 굴뚝 연기 나는 오두막, 오로라, 크리스마스 D-day, 10초마다 바뀌는 전구 패턴, 캐롤에 맞춰 노래하는 눈사람
- 문구 바꾸기 (한글 가능)
- 키보드: Space 일시정지 · R 다시 시작 · M 캐롤 · N 다음 곡 · Enter 트리 흔들기
