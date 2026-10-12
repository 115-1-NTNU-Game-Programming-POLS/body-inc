# 《人體股份有限公司》衛教內容查證報告

查證日期：2026-10-05　查證對象：`site/doc.md`（遊戲設計文件，Oct 5, 2026 版）

## 說明

本報告逐條檢查設計文件中與健康、醫療及法規相關的說法。判定分為四級：「正確」指方向與內容皆符合來源；「過度簡化但可接受」指方向正確，但遊戲文字或手冊需補一句條件或限制，避免玩家誤解；「需修正」指現行寫法與來源不符，或可能讓玩家做出不安全的決定；「無法確認」指查不到可信來源支持或反駁。

來源欄只列出實際開啟並確認內容的頁面。部分期刊網站（BMJ、PNAS、ScienceDirect、Wiley、NCBI Bookshelf）拒絕自動讀取，這些文獻改由 Europe PMC 公開 API 讀取摘要，來源欄列出的即為實際開啟的 API 網址。Dubois 與 Esculier（2020）的原文無法開啟，只能以引用該文的物理治療機構圖卡作為二手來源，已在該條註明。

---

## 一、文末指定須查證的五項

### 1. 電子菸邀約：「拒絕選項；說明相關法規」

**文件原說法**：事件「電子菸邀約」提供拒絕選項並說明相關法規，未寫出法規內容。

**判定**：正確（但法規內容需由本報告補上，以下為查證結果）

**查證結果**：《菸害防制法》修正條文於民國 112 年（2023）3 月 22 日施行，全面禁止電子煙等「類菸品」的製造、輸入、販賣、供應、展示、廣告及**使用**。第 15 條明定「任何人不得使用類菸品」，違者依第 40 條處新臺幣 2,000 元以上 10,000 元以下罰鍰；供應類菸品給他人者處 1 萬至 25 萬元罰鍰。也就是說，在台灣不論年齡，抽電子菸本身就違法，且有罰則；遞電子菸給同學的人觸犯的是「供應」，罰得更重。另依同法第 16 條，未滿 20 歲者不得吸菸（含一般紙菸）。健康面，WHO 指出電子菸「對健康有害、不安全」，尼古丁高度成癮，並影響青少年大腦發育，且未被證實可作為族群層級的戒菸工具。

**建議遊戲內寫法**：

> 學長遞來一支水果味的「小煙」：「這個沒有焦油啦，超香！」
> 免疫保全：「報告，偵測到可疑包裹。」
> 手冊〈菸害與電子菸〉：在台灣，電子菸從 2023 年 3 月 22 日起全面禁止，連「用」都違法，抽一口可罰 2,000 到 10,000 元；把電子菸拿給別人的人罰更重（1 萬到 25 萬）。水果味只是包裝，裡面的尼古丁一樣會上癮。

拒絕的代價可沿用「社交 −1」，但不建議設計「接受後只有小額社交加成」的選項，若要保留接受選項，應同時觸發成癮標籤與罰鍰事件。加熱菸的法律地位涉及「指定菸品」審查，情況較複雜，建議遊戲中不提。

**來源**：
- 全國法規資料庫《菸害防制法》全文：https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=L0070021
- 國民健康署〈暑假誘惑多 抽電子煙最重罰1萬元〉（2025/07/18）：https://www.hpa.gov.tw/Pages/Detail.aspx?nodeid=4878&pid=19230
- 衛生福利部〈菸害防制法修正施行全面禁止電子煙〉：https://www.mohw.gov.tw/cp-16-76180-1.html
- WHO Q&A: Tobacco: E-cigarettes：https://www.who.int/news-room/questions-and-answers/item/tobacco-e-cigarettes

---

### 2. 同學喝到叫不醒：「正確處理：讓對方側躺、不留下獨處、撥打 119」

**文件原說法**：危機事件「同學喝到叫不醒」，正確處理為讓對方側躺、不留下獨處、撥打 119。

**判定**：正確，但不完整（建議補上「叫不醒就是打 119 的時機」與常見錯誤做法）

**查證結果**：NHS 指出，懷疑酒精中毒、失去意識、抽搐或停止呼吸時應立即撥打急救電話；照顧者應陪在旁邊（有被自己嘔吐物嗆到的風險），昏迷者擺成復甦姿勢（側躺），注意保暖；不要讓對方再喝酒、不要給咖啡或含咖啡因飲料、不要沖冷水、不要催吐。美國 NIAAA 列出酒精過量的危險徵兆：意識混亂、難以保持清醒或叫不醒、嘔吐、抽搐、呼吸變慢或不規則、心跳變慢、皮膚濕冷、體溫極低；並指出冷水澡、熱咖啡、走路都無法逆轉酒精過量，且停止喝酒或昏睡後血中酒精濃度仍可能繼續上升，因此「讓他睡一覺就好」是危險迷思。臺北榮總員山分院的中毒緊急處理衛教單張也寫明：意識不清者應維持呼吸道暢通、立刻聯絡 119、暫時不給任何飲料、不可催吐；昏迷但能正常呼吸者採復甦姿勢；呼吸心跳停止時立即 CPR。

**建議遊戲內寫法**：選項建議設計成「一個正確、三個迷思」，讓玩家在迷思上踩雷：

> 小明趴在桌上，怎麼叫都叫不醒。
> A. 打 119，讓他側躺，你留在旁邊顧著（正確）
> B. 灌他一杯黑咖啡醒酒（迷思：咖啡不會解酒）
> C. 扶去浴室沖冷水（迷思：可能失溫、跌倒）
> D. 讓他睡一覺就好，大家先散了（迷思：昏睡後酒精濃度可能還在上升，獨處可能被嘔吐物嗆到）
> 手冊〈酒精中毒急救〉：叫不醒、呼吸很慢或不規則、抽搐、嘴唇發紫、皮膚濕冷，任何一項就打 119。等救護車時讓他側躺、陪著他、別給他喝東西、別挖喉嚨催吐。如果沒有呼吸，照 119 線上指示做 CPR。

**來源**：
- NHS, Alcohol poisoning：https://www.nhs.uk/conditions/alcohol-poisoning/
- NIAAA, Understanding the Dangers of Alcohol Overdose：https://www.niaaa.nih.gov/publications/brochures-and-fact-sheets/understanding-dangers-of-alcohol-overdose
- 臺北榮民總醫院員山分院〈中毒緊急處理〉衛教單張（109.05 修）：https://org.vghtpe.gov.tw/ysvh/files/files/%E4%B8%AD%E6%AF%92%E7%B7%8A%E6%80%A5%E8%99%95%E7%90%86.pdf

附註：該單張對「意識清醒者」仍寫有以手指刺激喉部催吐的舊式建議，與 NHS 的「不要催吐」不一致，遊戲中應一律採「不要催吐」。台灣政府機關中未找到專門針對急性酒精中毒急救的頁面。

---

### 3. 系際盃扭傷：「肌肉部罷工 1 天，需休息」

**文件原說法**：運動時 10% 機率扭傷，未暖身時加權；肌肉部罷工 1 天，需休息；手冊〈暖身與運動傷害〉。

**判定**：過度簡化但可接受（「需休息」方向正確；但手冊需寫清急性期處置，且避免寫成「完全不動直到好」）

**查證結果**：傳統建議為 PRICE。NHS 目前的寫法是受傷後頭 2 到 3 天：保護（Protection）、休息並避免負重（Rest）、冰敷（每 2 到 3 小時最多 20 分鐘，冰袋用毛巾包著）、加壓包紮（Compression）、抬高（Elevate）；頭幾天避免熱敷、酒精與按摩。中國醫藥大學附設醫院急診衛教亦建議 48 小時內冷敷、冰塊不可直接接觸皮膚。2020 年 Dubois 與 Esculier 在 BJSM 提出 PEACE & LOVE，前 1 到 3 天以保護、抬高、加壓、衛教為主，並建議避免抗發炎藥物（圖卡將冰敷列入同類，理由是可能干擾早期修復，但承認冰敷能止痛）；3 天後轉為 LOVE：在疼痛可忍受下逐步負重、保持樂觀、做不痛的有氧運動促進血流、做復健運動。換言之，「急性期保護與休息」兩派一致，爭議主要在冰敷與消炎藥；兩派也都強調不要長期完全不動。NHS 指出應立即就醫的情況：受傷時聽到「喀」一聲、患部變形或角度怪異、麻木或刺痛；無法負重或走不了幾步應就醫評估。

**建議遊戲內寫法**：

> 肌肉業務部：「腳踝……我的腳踝離職了……」
> 手冊〈暖身與運動傷害〉：扭傷的頭 1 到 3 天先保護：停止運動、不要硬撐、包紮、腳抬高；冰敷可以止痛，但要隔毛巾，一次不超過 20 分鐘。頭幾天不要熱敷、不要推拿按摩、不要喝酒。過了急性期，在不太痛的範圍內慢慢恢復活動，比一直躺著好得快。聽到「喀」一聲、腳變形、發麻，或痛到不能踩地，就去看醫生。

遊戲中建議只寫「冰敷可止痛」而不寫「冰敷可加速痊癒」，以免落入目前有爭議的說法。若手冊要提 PEACE & LOVE，應標明為「近年運動醫學的建議」，不要寫成「RICE 已被證明錯誤」。

**來源**：
- NHS, Sprains and strains：https://www.nhs.uk/conditions/sprains-and-strains/
- 中國醫藥大學附設醫院〈急診：一般挫傷、扭傷、瘀傷之注意事項〉：https://www.cmuh.cmu.edu.tw/HealthEdus/Detail?no=5375
- Lifemark〈The PEACE and LOVE approach to injury recovery〉圖卡（二手來源，引用 Dubois & Esculier, Br J Sports Med 2020;54(2):72-73；原文 BJSM 網站拒絕讀取）：https://www.lifemark.ca/document/users/diego.garcia@lifemark.ca/peaceandlove_infographic_fn.pdf

---

### 4. 校園流感疫苗接種：「感染機率下降；當天手臂痠痛」，第 1 至 3 天出現

**文件原說法**：每局 1 次、第 1 至 3 天出現；效果為感染機率下降、當天手臂痠痛。

**判定**：需修正（三處：生效時間、只防流感不防一般感冒、大學生非公費對象）

**查證結果**：
1. **副作用**：疾管署說明常見反應為注射部位疼痛、紅腫，少數有發燒、頭痛、肌肉痠痛等輕微全身反應，一般 1 到 2 天內自然恢復。「手臂痠痛」正確，持續時間應為 1 到 2 天而非僅當天。
2. **保護力與生效時間**：疾管署指出接種後至少約 2 週才產生保護力；保護力依年齡與健康狀況不同，平均約 30% 到 80%；對 18 歲以上成人因流感住院的保護力約 41%，對流感重症入住加護病房約 82%；接種 4 到 6 個月後保護效果可能下降，一般不超過 1 年，因此需每年接種。美國 CDC 亦說明需約兩週產生抗體，建議 6 個月以上所有人每季接種。
3. **只防流感**：疾管署明言一般感冒由數百種不同病毒引起，流感疫苗並不能預防感冒。文件中的感染模型以「病毒」統稱，「室友感冒」事件若因疫苗而降低感染機率，就會傳遞錯誤知識。
4. **大學生的身分**：疾管署公費流感疫苗對象為國小至高中職與五專一至三年級學生（校園集中接種）、50 歲以上、醫事人員、孕婦、BMI≥30 或有慢性病等高風險者等；一般大學生不在公費對象內，通常需自費。「校園流感疫苗接種」用於大學生時，宜改寫為自費接種，或由學校衛保組協辦。

**建議遊戲內寫法**：

> 衛保組：「流感疫苗自費接種開放登記！」
> 免疫保全：「收到新版通緝犯照片，給我兩週熟悉一下。」
> 效果：手臂痠痛 1 至 2 天；之後「流感」類事件的感染機率下降（只影響流感，不影響一般感冒）。
> 手冊〈流感疫苗〉：流感疫苗大約打完兩週後才開始有保護力，不是打完馬上變金剛。它擋不了所有流感，但能明顯降低重症和住院的機會。它也不防一般感冒，因為感冒是另外好幾百種病毒造成的。流感病毒每年在變，所以每年都要打。

數值面建議：若一個遊戲日代表學期中約 1 到 2 週，可讓保護效果自隔天起生效並在手冊註明「實際約需兩週」；感染判定需區分「流感」與「一般感冒」兩類事件。

**來源**：
- 疾管署〈疫苗有效性與安全性〉Q&A：https://www.cdc.gov.tw/Category/QAPage/ZtgdkdK4_XGPN-OlS2s7sg
- 疾管署〈流感疫苗〉頁面（含公費對象，最後更新 2026/9/24）：https://www.cdc.gov.tw/Category/Page/sc9enn8wcrLIufbqD9MFpw
- 疾管署〈流感與流感疫苗簡介〉Q&A：https://www.cdc.gov.tw/Category/QAPage/D1uGZc4_eZUpZogGNQxEzA
- 疾管署〈季節性流感防治〉Q&A（流感與感冒比較）：https://www.cdc.gov.tw/Category/QAPage/DQWXG19u2cXMH1jwGKXHug
- 疾管署〈不可不知！10大流感錯誤認知〉：https://www.cdc.gov.tw/Category/ListContent/AHwuigegBBBmuDcbWkzoGQ?uaid=jq-gY5yy1ov2THZ0t9w9Jg
- US CDC, Who Needs a Flu Vaccine：https://www.cdc.gov/flu/vaccines/vaccinations.html

---

### 5. 睡前滑手機停不下來：「入睡延後 0.5 至 1 小時」

**文件原說法**：日常事件，壓力高於 50 時加權；入睡延後 0.5 至 1 小時；手冊〈睡前螢幕使用〉。

**判定**：過度簡化但可接受（數值方向合理；手冊需避免把原因全部歸給藍光）

**查證結果**：Brautsch 等人（2023）針對 16 到 25 歲族群的系統性回顧納入 42 篇中高品質觀察性研究，結論為數位媒體使用與較短睡眠時數、較差睡眠品質相關，手機夜間使用與較晚就寢及白天疲倦相關；但多為觀察性研究，因果方向尚待確認。JAMA Pediatrics 2025 年一項以影像客觀記錄螢幕使用的青少年研究（79 人、323 晚）發現，「上床後」的螢幕使用每多 10 分鐘，總睡眠約少 3 分鐘，互動性活動（遊戲、多工）影響較大，使用社群媒體的夜晚入睡平均晚 38 分鐘；而「睡前 2 小時」的螢幕時間與總睡眠時數無關。Chang 等人（2015, PNAS）的實驗顯示睡前用發光電子書閱讀比紙本書更難入睡、褪黑激素分泌較少、隔天早上較不清醒，支持光線的作用，但在真實生活中，「滑到停不下來」所占用的時間與內容造成的興奮，影響可能比藍光本身更大。整體證據強度屬中等：關聯一致，因果與效果大小仍有不確定性。

**建議遊戲內寫法**：

> 大腦董事長：「再看一支影片就睡。」（第 14 支）
> 效果：入睡延後 0.5 至 1 小時。
> 手冊〈睡前螢幕使用〉：躺在床上滑手機，最直接的代價是時間被吃掉，加上內容讓腦袋太興奮，就更難睡著。螢幕的光也會讓身體晚一點進入睡覺模式。研究大多看到「睡前滑越久、睡越少」，但每個人差很多，遊戲裡的數字是簡化。

避免寫「藍光會讓你失眠」這類單一原因的說法；夜間模式不能抵銷熬夜滑手機本身的時間成本。

**來源**：
- Brautsch et al., Sleep Med Rev 2023（Europe PMC 摘要）：https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=TITLE:%22Digital%20media%20use%20and%20sleep%20in%20late%20adolescence%20and%20young%20adulthood%22&resultType=core&format=json
- JAMA Pediatrics, Screen Use at Bedtime and Sleep Duration and Quality Among Youths：https://jamanetwork.com/journals/jamapediatrics/fullarticle/2822859
- Chang et al., PNAS 2015（Europe PMC 摘要）：https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=DOI:10.1073/pnas.1418490112&resultType=core&format=json

---

## 二、其他事件清單條目

### 6. 夜衝：「睡眠債 +4；隔天疲勞騎車徵兆」

**判定**：過度簡化但可接受（風險方向正確；建議把危險時段改到夜衝回程當下，並加入迷思選項）

**查證結果**：AAA 交通安全基金會研究顯示，與過去 24 小時睡滿 7 小時以上者相比，睡 6 到 7 小時者肇事率為 1.3 倍、5 到 6 小時 1.9 倍、4 到 5 小時 4.3 倍、不足 4 小時 11.5 倍；美國睡眠醫學會指出睡 4 到 5 小時的風險與酒駕相當。NIOSH 訓練教材指出清醒 17 小時約相當於血中酒精濃度 0.05%，清醒 24 小時約相當於 0.10%。NIOSH 另指出搖下車窗、開大音樂、捏自己都沒有研究證實能保持清醒，應停車休息；咖啡因與小睡可短暫改善。美國 NHLBI 說明睡眠不足對駕駛的傷害與酒駕相當或更甚。上述研究以汽車駕駛為主，機車騎士在事故中更缺乏保護，風險方向只會更不利。夜衝本身多在凌晨騎車，最危險的時段是回程，不只是隔天。

**建議遊戲內寫法**：

> 凌晨四點，看完日出準備騎回宿舍。大腦：「我眼睛……閉一下下就好……」
> A. 先在超商趴睡 20 分鐘再騎（較安全）
> B. 換朋友載、叫車或等第一班車（安全）
> C. 開大音樂、打開安全帽面罩吹風硬撐（迷思：沒有證據有效）
> 手冊〈疲勞駕駛〉：整晚沒睡就騎車，反應跟喝了酒差不多。吹風、聽音樂撐不住，真正有用的只有睡覺；咖啡和小睡只能撐一下下。

**來源**：
- AAA Foundation, Acute Sleep Deprivation and Risk of Motor Vehicle Crash Involvement：https://aaafoundation.org/acute-sleep-deprivation-risk-motor-vehicle-crash-involvement/
- AASM, AAA study links sleep loss to increased motor vehicle crash risk：https://aasm.org/aaa-study-links-sleep-loss-to-increased-motor-vehicle-crash-risk/
- CDC NIOSH, Impairments due to sleep deprivation are similar to impairments due to alcohol intoxication：https://www.cdc.gov/niosh/work-hour-training-for-nurses/longhours/mod3/08.html
- CDC NIOSH（archive）, Risks from Not Getting Enough Sleep: Drowsy：https://archive.cdc.gov/www_cdc_gov/niosh/emres/longhourstraining/drowsy.html
- NHLBI, Sleep Deprivation and Deficiency: Health Effects：https://www.nhlbi.nih.gov/health/sleep-deprivation/health-effects

---

### 7. 腸胃炎與嚴重脫水：「脫水風險」「及時補充水分與電解質，否則送急診」

**判定**：需修正（危機階段的「正確處理」不應是自行補水）

**查證結果**：NHS 建議腹瀉嘔吐時少量多次喝水，可用藥局的口服補液鹽，避免果汁與汽水（可能讓腹瀉更嚴重）；嘔吐通常 1 到 2 天停止，腹瀉 5 到 7 天。美國 NIDDK 說明多數成人可用水、果汁、運動飲料、清湯補充，但症狀嚴重或已出現脫水徵兆者應使用口服電解質液；出現脫水徵兆（極度口渴、尿少、尿色深、頭暈或暈倒等）、腹瀉超過 2 天、高燒、頻繁嘔吐、一天 6 次以上稀便、劇烈腹痛、黑便或血便、精神狀態改變時應立即就醫；無法喝下足夠液體時也應就醫。台灣食藥署《藥物食品安全週報》刊載的小兒科醫師意見則認為運動飲料糖分高、稀釋後電解質又不足，建議改用藥局的口服電解質液。綜合而言，「口服電解質液最理想；成人輕症喝水或清湯亦可；運動飲料不是首選」是可接受的寫法。文件危機層級的「嚴重脫水」若仍以「自己補水」為正確解，會讓玩家以為嚴重脫水可自行處理。

**建議遊戲內寫法**：

> 徵兆（中等）：尿變少、顏色變深、嘴巴很乾。正確處理：小口小口喝口服電解質液（藥局買得到），或白開水、清湯。
> 危機（嚴重脫水）：喝了就吐、站起來頭暈、一整天幾乎沒尿、拉出血或黑便。正確處理：立刻就醫，可能需要打點滴。
> 手冊〈腸胃炎與補充水分〉：運動飲料糖分偏高、鈉不夠，不是腸胃炎的首選；口服電解質液比較對味。

**來源**：
- NHS, Diarrhoea and vomiting：https://www.nhs.uk/conditions/diarrhoea-and-vomiting/
- NIDDK, Treatment of Viral Gastroenteritis：https://www.niddk.nih.gov/health-information/digestive-diseases/viral-gastroenteritis/treatment
- NIDDK, Symptoms & Causes of Viral Gastroenteritis：https://www.niddk.nih.gov/health-information/digestive-diseases/viral-gastroenteritis/symptoms-causes
- 自由健康網轉載食藥署《藥物食品安全週報》第 806 期（2021/02/26，小兒科醫師陳俊仁）：https://health.ltn.com.tw/article/breakingnews/3450749

---

### 8. 發燒與感冒升級規則：「未休息又熬夜，升級為發燒……此時應就醫並請假休息」

**文件原說法**：升級規則第 1 級「喉嚨有點癢，多喝水、當晚早睡即可止住」；第 2 級「休息或就醫可縮短病程」；第 3 級「未休息又熬夜，升級為發燒，應就醫並請假休息」；事件「發燒」觸發條件為「感冒後未休息 1 天以上」。

**判定**：過度簡化但可接受，其中第 1、2 級的措辭需修正

**查證結果**：
- 疾管署列出應儘速就醫的流感危險徵兆：呼吸急促或困難、發紺（嘴唇發紫）、血痰、胸痛、意識改變、低血壓，以及高燒持續 72 小時；並建議生病時多休息、不上班不上課，在未使用退燒藥的情況下退燒 24 小時後才返校。NHS 對成人發燒的定義為 38°C 以上，居家照護為休息、補水、必要時退燒藥，在家處理卻沒改善或變差時應就醫；NHS 一般感冒頁面建議發燒超過 3 天、症狀超過 10 天、呼吸急促或胸痛時就醫。
- 一般感冒通常 1 到 2 週好轉，沒有能治癒的藥，抗生素無效（NHS）。「就醫可縮短病程」對一般感冒不成立；看醫生的價值在於排除其他疾病、處理症狀、判斷是否為流感（流感抗病毒藥需由醫師評估）。
- 「多喝水、早睡即可止住」屬過度承諾。睡眠不足確實與較高的感冒易感性相關（見第 26 條），但沒有證據顯示早睡一晚就能「止住」感冒。
- 「不休息、熬夜會把感冒變成發燒」的因果在文獻中沒有直接支持；發燒較常見於流感，流感常突然發作。作為遊戲中「病情加重」的抽象可以接受，但手冊不應寫成醫學事實。

**建議遊戲內寫法**：

> 第 1 級：免疫保全「喉嚨有點癢。」正確處理：早點睡、多喝水，讓保全有力氣上工（降低惡化機率，不是保證止住）。
> 第 2 級：感冒。正確處理：休息。看醫生能幫忙緩解症狀、確認是不是流感，但感冒本身大多要 1 到 2 週自己好。
> 第 3 級：發燒。正確處理：請假在家休息、補充水分；燒了 3 天還不退，或出現呼吸困難、胸痛、意識不清、嘴唇發紫，要趕快就醫。退燒滿 24 小時（沒吃退燒藥）再回學校。

**來源**：
- 疾管署〈季節性流感防治〉Q&A：https://www.cdc.gov.tw/Category/QAPage/DQWXG19u2cXMH1jwGKXHug
- NHS, High temperature (fever) in adults：https://www.nhs.uk/symptoms/fever-in-adults/
- NHS, Common cold：https://www.nhs.uk/conditions/common-cold/

---

### 9. 能量飲料連灌：「咖啡因 +150；心悸使大腦效率波動」

**判定**：正確（數值合理，手冊需補每日上限）

**查證結果**：美國 FDA 指出健康成人每天 400 毫克咖啡因通常不致產生負面影響，能量飲料的咖啡因含量差異很大，過量可能出現心跳加快、心悸、血壓升高、失眠、焦躁、手抖、腸胃不適、頭痛，且個人對咖啡因的敏感度與代謝速度差異大。EFSA 認為健康成人單次 200 毫克、每日 400 毫克不致引起安全疑慮，且單次 100 毫克在接近睡前攝取可能影響部分成人睡眠。衛福部頁面則建議每日咖啡因攝取量在 300 毫克以下，並規定包裝飲料每 100 毫升含 20 毫克以上須標示含量，現煮咖啡以紅（201 毫克以上）、黃（101 至 200 毫克）、綠（100 毫克以下）標示。台灣官方數字（300 毫克）比國際（400 毫克）保守，台灣玩家看到的標示也以衛福部為準，手冊建議採 300 毫克。

**建議遊戲內寫法**：

> 心臟（只有顏色，但這次閃得很厲害）：「董事長，我在跳 Disco。」
> 手冊〈咖啡因與能量飲料〉：衛福部建議成人一天咖啡因不要超過 300 毫克，買飲料時看包裝或杯子上的紅黃綠標示。一次灌太多可能心悸、手抖、睡不著。心跳很快又胸悶、喘不過氣，就別再喝並就醫。

**來源**：
- US FDA, Spilling the Beans: How Much Caffeine is Too Much?：https://www.fda.gov/consumers/consumer-updates/spilling-beans-how-much-caffeine-too-much
- EFSA, Caffeine topic page：https://www.efsa.europa.eu/en/topics/topic/caffeine
- 衛生福利部〈選購認清咖啡因含量，保障你我健康〉：https://www.mohw.gov.tw/cp-3204-21749-1.html

---

### 10. 系烤或迎新喝酒、勸酒：「可選喝多少；酒精標籤」

**判定**：正確（建議補充年齡規定與飲酒限量）

**查證結果**：《兒童及少年福利與權益保障法》第 43 條規定兒童及少年（未滿 18 歲）不得吸菸、飲酒、嚼檳榔，任何人不得供應。宿主是大二生，飲酒合法，但目標玩家包含國高中生，手冊宜註明 18 歲規定。國民健康署飲食指標建議若飲酒，男性每日不宜超過 2 杯、女性不宜超過 1 杯（每杯酒精 10 公克，約 250 毫升 5% 啤酒）。

**建議遊戲內寫法**：

> 手冊〈拒絕勸酒〉：在台灣，未滿 18 歲不能喝酒，也沒有人可以拿酒給未成年。成年人如果要喝，健康署建議男生一天最多 2 杯、女生 1 杯，一杯大約是半罐 500 毫升的啤酒。

**來源**：
- 全國法規資料庫《兒童及少年福利與權益保障法》第 43 條：https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=D0050001&flno=43
- 衛生福利部新聞稿附件〈常見酒類之酒精含量表〉（摘自國民健康署國民飲食指標手冊）：https://www.mohw.gov.tw/dl-58612-ae275510-f3ab-4327-9b2d-b6976d0f20ef.html

---

### 11. 想家或分手後情緒低落：「可選找朋友聊或預約學校諮商中心」

**判定**：正確（建議補上 24 小時專線）

**查證結果**：衛福部 1925 安心專線（依舊愛我）以市話或手機直撥，全年無休、24 小時、免付費。文件已規定心理健康事件只提供求助管道、不做診斷、不出現自傷內容，方向正確。

**建議遊戲內寫法**：在手冊〈情緒低落與求助〉末尾固定附上「學校諮商中心」與「1925 安心專線（24 小時免付費）」。

**來源**：
- 衛生福利部〈安心專線108年12月20日正式單軌使用1925〉：https://www.mohw.gov.tw/cp-4250-50587-1.html

---

### 12. 感冒就醫要求抗生素（抗生素陷阱）

**文件原說法**：感冒就醫時要求抗生素 → 感冒未改善、腸道菌團隊被誤殺 → 腹瀉；對應知識「感冒多為病毒感染，抗生素對病毒無效；抗藥性問題」。

**判定**：正確（情境設計需微調，抗藥性的描述需精準）

**查證結果**：疾管署指出一般感冒或病毒性上呼吸道感染不應使用抗生素，不當使用會促使細菌產生抗藥性，並提到困難梭菌腹瀉的案例。衛福部「四不一要」：不主動要求抗生素、不隨便自己買、不吃他人的抗生素、不隨便停藥、要遵守醫囑；抗生素可能造成腹瀉、噁心並影響腸道菌叢平衡。美國 CDC 亦列出抗生素對感冒、流感無效，常見副作用含腹瀉，嚴重者可能發生困難梭菌感染。

兩點需注意。其一，抗藥性是「細菌」演化出來的，不是人體對藥物產生耐受；常見誤解是「吃太多抗生素身體會有抗藥性」。其二，在台灣，醫師依規範不應為一般感冒開抗生素，情境若寫成「要求就拿得到」，可能讓玩家以為這是常態。

**建議遊戲內寫法**：

> 選項：「醫生，可以開抗生素嗎？比較快好。」
> 醫師：「感冒是病毒，抗生素只打細菌，吃了沒用喔。」
> 若玩家選「吃室友上次剩下的抗生素」：腸道菌外包團隊遭誤殺，腹瀉；感冒照樣。
> 手冊〈抗生素不治感冒〉：抗生素只對細菌有效。亂吃不但治不了感冒，還可能拉肚子，也會讓細菌練出抗藥性，以後真的需要時藥就沒效了。記住「四不一要」：不主動要、不自己買、不吃別人的、不隨便停，要照醫生指示吃完。

**來源**：
- 疾管署〈合理使用抗生素 避免產生抗藥性〉：https://www.cdc.gov.tw/Category/ListContent/3263Cslsb96HH82yOx-T8A?uaid=GFmwlPgHN3cuTZEo9csPiw
- 衛生福利部〈守護兒童用藥安全 使用抗生素四不一要〉：https://www.mohw.gov.tw/cp-16-83181-1.html
- US CDC, Antibiotic Use: About：https://www.cdc.gov/antibiotic-use/about/index.html
- NHS, Common cold（GP 不會為感冒開抗生素）：https://www.nhs.uk/conditions/common-cold/

---

### 13. 全糖手搖飲團購：「飯後倦怠 2 小時，讀書效率 × 0.85」

**判定**：正確

**查證結果**：Mantantzis 等人（2019）整合 31 篇研究、1,259 名受試者的統合分析發現，攝取碳水化合物後在任何時間點都沒有改善情緒的證據，反而在 30 分鐘內疲倦感上升、60 分鐘內警覺性下降。「sugar rush」是迷思，「糖後倦怠」有證據支持。

**建議遊戲內寫法**：手冊〈糖分與疲倦〉：「喝完全糖以為會很有精神？研究發現大量吃糖後半小時到一小時內，人反而比較累、比較不清醒。」

**來源**：
- Mantantzis et al., Neurosci Biobehav Rev 2019（Warwick 典藏）：https://wrap.warwick.ac.uk/id/eprint/115618/

---

### 14. 鹹酥雞宵夜：「睡眠效率 × 0.9」；胃的對應知識「睡前進食影響睡眠」

**判定**：過度簡化但可接受（證據屬初步）

**查證結果**：Chung 等人（2020）調查 793 名 18 至 29 歲大學生，睡前 3 小時內進食與夜間醒來的勝算比 1.61（調整後 1.43）相關，但與入睡時間過長、睡眠過短無關；作者強調這是初步的橫斷研究。證據支持「可能讓半夜比較容易醒」，不足以支持「睡前吃東西一定睡不好」。

**建議遊戲內寫法**：胃物流主管：「半夜還送貨來？我今晚加班，你也別想睡得太安穩。」手冊：「睡前吃大餐，胃得加班消化，有研究發現睡前 3 小時內吃東西的大學生比較容易半夜醒來。」

**來源**：
- Chung et al., IJERPH 2020（Europe PMC 摘要）：https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=TITLE:%22proximity%20of%20meals%20to%20bedtime%22&resultType=core&format=json

---

### 15. 久坐趕報告肩頸痠痛：「起身伸展可解除」

**判定**：過度簡化但可接受

**查證結果**：WHO 指出成人久坐時間增加與全因死亡、心血管疾病、癌症與第二型糖尿病風險上升相關，建議成人每週至少 150 分鐘中等強度身體活動、青少年每天平均 60 分鐘。肩頸痠痛與伸展的直接效果未找到官方來源，但「起身動一動」符合減少久坐的原則。「解除」宜改為「緩解」。

**建議遊戲內寫法**：「起身伸展可緩解」；手冊〈久坐與伸展〉：「坐太久不只肩頸痠，長期久坐跟心血管疾病、糖尿病風險變高有關。讀一段時間就起來走走。」

**來源**：
- WHO, Physical activity fact sheet：https://www.who.int/news-room/fact-sheets/detail/physical-activity

---

### 16. 新生健檢報告：「揭露肝臟等沉默部門的目前狀態」

**判定**：正確（見第 20 條）

---

## 三、部門員工設定表「對應知識」欄

### 17. 大腦：「睡眠不足降低注意力與記憶力；大腦血流自動調節」

**判定**：前半正確；「大腦血流自動調節」與「加派代幣給大腦提升讀書效率」之間有概念矛盾，需修正說法

**查證結果**：NHLBI 指出睡眠不足會讓人反應變慢、犯更多錯，並影響學習與記憶所需的神經路徑形成。Rasch 與 Born（2013）回顧百年研究，確立睡眠有助記憶保存（支持「考試分數乘以睡眠係數」）。Claassen 等人（2021）說明腦血流受四種機制調節：自動調節（因應灌流壓變化維持穩定）、對二氧化碳等的血管反應、神經血管耦合（局部神經活動增加時局部血流隨之增加）以及內皮依賴反應。因此文件「大腦固定保障 2 枚、不可挪動」對應自動調節是合理的；但「代幣代表血流預算」且「額外加派代幣給大腦使讀書效率提升 10%」，等於暗示「把更多血送到腦袋就會變聰明」，這與文件自己在飯後嗜睡段落所修正的觀念相衝突。實際上是大腦用功時局部血流跟著增加（結果），不是送更多血讓人變聰明（原因）。

**建議遊戲內寫法**：保留玩法，改變說法。可將加派到大腦的代幣解釋為「董事長的專注力預算」或「加開會議室」，並在手冊〈大腦〉註明：「大腦的總血流被身體保護得很穩，不會因為你多分一點就變聰明；用功的腦區會自己跟身體要血，這叫神經血管耦合。遊戲中的代幣是簡化。」

**來源**：
- NHLBI, Sleep Deprivation and Deficiency: Health Effects：https://www.nhlbi.nih.gov/health/sleep-deprivation/health-effects
- Rasch & Born, Physiol Rev 2013（Europe PMC 摘要）：https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=TITLE:%22About%20sleep's%20role%20in%20memory%22&resultType=core&format=json
- Claassen et al., Physiol Rev 2021（Europe PMC 摘要）：https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=TITLE:%22Regulation%20of%20cerebral%20blood%20flow%20in%20humans:%20physiology%20and%20clinical%20implications%20of%20autoregulation%22&resultType=core&format=json

### 18. 胃：「消化需要時間；睡前進食影響睡眠」

**判定**：過度簡化但可接受（見第 14 條）

### 19. 腸道菌：「腸道菌相與膳食纖維；抗生素會影響菌相」；人設「族群越多元越好，最愛纖維」

**判定**：正確（「越多元越好」屬簡化，可接受）

**查證結果**：Makki 等人（2018）回顧指出膳食纖維直接與腸道菌交互作用，產生短鏈脂肪酸等關鍵代謝物，影響腸道菌生態與宿主健康。抗生素影響腸道菌叢平衡見第 12 條衛福部來源。

**來源**：
- Makki et al., Cell Host Microbe 2018（Europe PMC 摘要）：https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=TITLE:%22The%20impact%20of%20dietary%20fiber%20on%20gut%20microbiota%20in%20host%20health%20and%20disease%22&resultType=core&format=json
- 衛生福利部〈守護兒童用藥安全 使用抗生素四不一要〉：https://www.mohw.gov.tw/cp-16-83181-1.html

### 20. 肝：「肝臟病變初期常無症狀」

**判定**：正確

**查證結果**：國民健康署指出大部分肝病沒有明顯症狀，民眾容易因警覺性不夠而延誤就醫，B、C 型肝炎帶原者需定期追蹤；國健署提供 45 至 79 歲（原住民 40 歲起）一生一次 B、C 肝篩檢。「肝從不抱怨，直到某天直接離職」與官方說法一致。

**建議遊戲內寫法**：手冊：「肝臟裡面幾乎沒有痛覺神經，出問題時常常不痛不癢，所以要靠抽血檢查才知道。」（「幾乎沒有痛覺神經」常見於民間衛教，本次未開啟原始頁面確認，國健署頁面也未明寫；若要保守，只寫「常常沒有症狀」即可。）

**來源**：
- 國民健康署〈肝病只要沒有明顯症狀，就不需要接受檢查及治療?〉：https://www.hpa.gov.tw/Pages/Detail.aspx?nodeid=127&pid=15587

### 21. 肝：「空腹時釋放葡萄糖維持血糖」

**判定**：正確（手冊需補「喝酒時例外」，見第 31 條）

**查證結果**：Molecular Aspects of Medicine（2015）回顧指出，即使只空腹幾小時，肝臟就會透過肝醣分解與糖質新生兩條路徑把葡萄糖釋放到血液中。Bath Breakfast Project 隨機對照試驗（Betts et al., 2014，對象為體型正常的健康成人）中，不吃早餐組到試驗最後一週時下午與晚上的血糖波動較吃早餐組大，且吃早餐組每日總熱量仍多 539 大卡，表示不吃早餐者只部分補償少吃的熱量；摘要未報告低血糖事件。

**來源**：
- Molecular Pathophysiology of Hepatic Glucose Production, Mol Aspects Med 2015：https://pmc.ncbi.nlm.nih.gov/articles/PMC4674831/
- Betts et al., Am J Clin Nutr 2014（Europe PMC 摘要）：https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=TITLE:%22causal%20role%20of%20breakfast%20in%20energy%20balance%22&resultType=core&format=json

### 22. 肝：「酒精代謝速率有上限」

**判定**：正確（數值見第 29 條）

### 23. 免疫：「過敏是免疫過度反應；長期壓力壓抑免疫」

**判定**：正確

**查證結果**：NHS 說明過敏是身體對通常無害的東西（食物、花粉、塵蟎等）產生反應。Segerstrom 與 Miller（2004）統合 30 年、300 多篇研究：短暫急性壓力會上調部分先天免疫，長期慢性壓力則同時抑制細胞性與體液性免疫，考試這類短期自然壓力傾向抑制細胞免疫。文件「長期高壓才砍免疫預算」與此一致，比「有壓力就免疫差」更精準。

**來源**：
- NHS, Allergies：https://www.nhs.uk/conditions/allergies/
- Segerstrom & Miller, Psychol Bull 2004（Europe PMC 摘要）：https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=TITLE:%22Psychological%20stress%20and%20the%20human%20immune%20system%22%20AND%20AUTH:%22Segerstrom%22&resultType=core&format=json

### 24. 肌肉：「肌肉不使用會流失；運動改善睡眠與壓力」；心臟：「規律運動對心血管有益」

**判定**：正確

**查證結果**：Dirks 等人（2018）指出即使只有幾天的固定不動或臥床，也會造成可觀的骨骼肌流失。WHO 指出規律身體活動降低全因死亡、心血管疾病死亡、高血壓、第二型糖尿病等風險，並改善心理健康、認知與睡眠。

**來源**：
- Dirks, Wall & van Loon, J Appl Physiol 2018 等（Europe PMC 摘要）：https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=TITLE:%22disuse%22%20AND%20TITLE:%22muscle%22%20AND%20TITLE:%22humans%22%20AND%20PUB_TYPE:%22review%22&resultType=core&format=json&pageSize=5
- WHO, Physical activity fact sheet：https://www.who.int/news-room/fact-sheets/detail/physical-activity

### 25. 腎臟：「腎臟過濾需要足夠水分」

**判定**：過度簡化但可接受（建議改寫成可查證的版本）

**查證結果**：「過濾需要足夠水分」的說法未找到直接來源。可查證的是：水分不足時尿量減少、尿色變深（NIDDK 脫水徵兆），以及「喝足夠的水（主要是白開水）是預防腎結石最重要的一件事」（NIDDK）。

**建議遊戲內寫法**：腎臟會計部：「進帳（水）太少，我只好把尿濃縮再濃縮。」手冊：「水喝太少，尿會變少、顏色變深；長期喝太少水是腎結石的風險之一。」

**來源**：
- NIDDK, Eating, Diet, & Nutrition for Kidney Stones：https://www.niddk.nih.gov/health-information/urologic-diseases/kidney-stones/eating-diet-nutrition
- NIDDK, Symptoms & Causes of Viral Gastroenteritis（脫水徵兆）：https://www.niddk.nih.gov/health-information/digestive-diseases/viral-gastroenteritis/symptoms-causes

---

## 四、五條核心連鎖

### 26. 咖啡因陷阱：「咖啡因半衰期約 5 小時」

**判定**：過度簡化但可接受（文件已註明個體差異，但範圍寫得太窄）

**查證結果**：Somani 與 Gupta（1988）回顧指出咖啡因半衰期介於 1.5 到 9.5 小時，抽菸會縮短半衰期；美國 FDA 也說明個人代謝咖啡因的速度差異很大。文件寫「個體差異約在 3 至 7 小時」比文獻常見範圍窄。Drake 等人（2013）實驗顯示，睡前 0、3、6 小時攝取 400 毫克咖啡因都會顯著干擾睡眠，支持「下午以後的咖啡有代價」的設計。

**建議遊戲內寫法**：手冊〈咖啡因〉：「咖啡因在身體裡平均大約 5 小時才剩一半，但每個人差很多，快的人 2 小時、慢的人可能超過 8 小時（抽菸的人代謝較快，吃避孕藥或懷孕的人較慢）。研究發現就算睡前 6 小時喝，還是會影響睡眠。」若不想列出避孕藥與懷孕，可只寫「快的人 2 小時、慢的人超過 8 小時」。

**來源**：
- Somani & Gupta, Int J Clin Pharmacol Ther Toxicol 1988（Europe PMC 摘要）：https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:3072303&resultType=core&format=json
- Drake et al., J Clin Sleep Med 2013（Europe PMC 摘要）：https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=DOI:10.5664/jcsm.3170&resultType=core&format=json
- US FDA, Spilling the Beans：https://www.fda.gov/consumers/consumer-updates/spilling-beans-how-much-caffeine-too-much

附註：「避孕藥與懷孕使半衰期延長」只在搜尋摘要中看到，未開啟原始文獻確認，若寫入手冊需再查。

### 27. 早餐翹班：「健康者不吃早餐不會低血糖（肝臟維持）；高糖飲食後的疲倦感」

**判定**：正確（但「中午暴食」不是生理必然，建議寫成玩家的選擇）

**查證結果**：見第 13、21 條。Bath Breakfast Project 發現不吃早餐者只部分補償熱量，並非必然暴食；連鎖中的「中午暴食加手搖飲」應呈現為誘惑選項，而非自動結果。手冊需加一句適用範圍：「健康的人」不包含使用胰島素或部分降血糖藥的糖尿病患者，也不適用於喝酒後（見第 31 條）。

### 28. 壓力螺旋：「長期壓力壓抑免疫功能」

**判定**：正確（見第 23 條）

### 29. 聚餐宿醉：「酒精代謝速率有上限；酒精影響睡眠」；特殊公式「肝臟每小時約可代謝 7 至 10 公克酒精，台灣一個標準杯為 10 公克」

**判定**：過度簡化但可接受（標準杯 10 公克正確；7 至 10 公克對體型較小者偏高）

**查證結果**：衛福部附件引用國健署國民飲食指標手冊，一杯為酒精 10 公克，相當於 5% 啤酒 250 毫升。Jones（2010）彙整的血中酒精清除速率生理範圍為每小時 10 到 35 mg/100 mL，中度飲酒者平均約 15 mg/100 mL。以 Widmark 公式換算（本報告推算，非來源原文），70 公斤男性約每小時 7 公克，50 公斤女性約每小時 4 公克，個體範圍約 4 到 17 公克。因此「每小時 7 至 10 公克」對台灣大學生（尤其體重較輕者）偏高，但「每小時代謝不到一杯、多喝不會變快」的方向正確。Ebrahim 等人（2013）回顧指出酒精在各劑量下都會縮短入睡時間、使前半夜睡得較沉，但增加後半夜的睡眠中斷，並延後與減少快速動眼期，支持「喝酒好睡是錯覺」。

**建議遊戲內寫法**：手冊〈酒精代謝〉：「肝臟一小時大約只能處理半杯到一杯的酒（體重越輕越慢），喝再多也不會加班加速。喝酒後雖然比較快睡著，但下半夜容易醒、睡眠品質變差。」

**來源**：
- 衛生福利部附件〈常見酒類之酒精含量表〉：https://www.mohw.gov.tw/dl-58612-ae275510-f3ab-4327-9b2d-b6976d0f20ef.html
- Jones, Forensic Sci Int 2010（Europe PMC 摘要）：https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=TITLE:%22Evidence-based%20survey%20of%20the%20elimination%20rates%20of%20ethanol%20from%20blood%22&resultType=core&format=json
- Ebrahim et al., Alcohol Clin Exp Res 2013（Europe PMC 摘要）：https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=TITLE:%22Alcohol%20and%20sleep%20I%22%20AND%20AUTH:%22Ebrahim%22&resultType=core&format=json

### 30. 抗生素陷阱

**判定**：正確（見第 12 條）

---

## 五、特殊公式與其他疑慮

### 31. 文件未提及但建議補上：空腹喝酒時肝臟無法維持血糖

**判定**：建議新增（與既有連鎖直接相關的安全知識）

**查證結果**：Diabetes（1975）指出空腹者攝取乙醇會抑制糖質新生而降低血糖；PNAS（2015）指出急性酒精中毒透過增加肝臟 NADH 抑制糖質新生，促成空腹低血糖。文件設定「酒精在體內時肝臟代幣全數用於代謝酒精」，與「空腹時肝臟負責維持血糖」放在一起，恰好可以教「空腹喝酒特別危險」。

**建議遊戲內寫法**：若宿主同時帶有「沒吃早餐/未進食」與「酒精」標籤，肝臟無法維持血糖，觸發「頭暈冒冷汗」徵兆。手冊：「肝臟忙著處理酒精時，就沒空幫你穩住血糖，所以空腹喝酒特別容易出事。喝酒前先吃東西。」

**來源**：
- Europe PMC 檢索（含 PMID 1090474、25730876 摘要）：https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=ABSTRACT:%22hypoglycemia%22%20AND%20ABSTRACT:%22gluconeogenesis%22%20AND%20(ABSTRACT:%22ethanol%22%20OR%20ABSTRACT:%22alcohol%22)%20AND%20ABSTRACT:%22fasting%22&resultType=core&format=json&pageSize=8

### 32. 感染機率公式：「研究顯示睡眠少於 6 小時者感冒風險約為 4.2 倍，遊戲取 1.4 倍屬保守設定」

**判定**：需修正（數字的意義與引用連結都有誤）

**查證結果**：Prather 等人（2015, Sleep）讓 164 名健康成人接觸鼻病毒，以腕動計測量睡眠：睡 5 到 6 小時者發生臨床感冒的勝算比為 4.24，睡不到 5 小時者為 4.50，均相對於睡 7 小時以上者；睡 6 到 7 小時者無顯著差異（1.66）。信賴區間很寬（約 1.08 至 18），且樣本小。三個問題：其一，這是勝算比（odds ratio），不是風險倍數，寫「風險約為 4.2 倍」會高估；其二，4.24 對應的是 5 到 6 小時，不是「少於 6 小時」的整體；其三，文件審查紀錄所附連結 PMC4531398 實際上是 Besedovsky 與 Born 的評論文章〈Sleep, Don't Sneeze〉，Prather 原文為 PMC4531403（PMID 26118561）。遊戲取 1.4 倍是保守的設計選擇，可以保留。

**建議文件寫法**：「一項 164 人的病毒接觸實驗發現，每晚只睡 5 到 6 小時的人，感冒的勝算約是睡 7 小時以上者的 4 倍，但樣本小、誤差範圍大；遊戲取 1.4 倍為保守設定。」手冊：「有實驗讓人接觸感冒病毒，睡不到 6 小時的人比睡飽的人更容易真的感冒。」連結改為 Prather 原文。

**來源**：
- Prather et al., Sleep 2015（Europe PMC 摘要）：https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=TITLE:%22Behaviorally%20Assessed%20Sleep%20and%20Susceptibility%20to%20the%20Common%20Cold%22&resultType=core&format=json
- PMC4531398 的實際內容（Besedovsky & Born 評論）：https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=PMCID:PMC4531398&resultType=core&format=json

### 33. 咖啡因耐受與戒斷：「連續 3 天每天喝 2 杯以上會產生耐受……停喝的第一天讀書效率 × 0.9，對應戒斷頭痛」

**判定**：正確（方向與時程大致相符）

**查證結果**：Juliano 與 Griffiths（2004）回顧指出，戒斷症狀通常在停用後 12 到 24 小時出現，20 到 51 小時達高峰，持續 2 到 9 天；每日低至 100 毫克的劑量停用後也可能出現症狀；實驗研究中頭痛發生率約 50%。「停喝第一天」出現影響合理；若要更貼近事實，可讓影響持續 2 天，並在手冊寫「約一半的人會頭痛」。

**來源**：
- Juliano & Griffiths, Psychopharmacology 2004（Europe PMC 摘要）：https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=TITLE:%22critical%20review%20of%20caffeine%20withdrawal%22&resultType=core&format=json

### 34. 短暫午睡恢復部分大腦產能（〈短暫午睡〉解鎖 20 分鐘午睡）

**判定**：正確

**查證結果**：Dutheil 等人（2021, IJERPH）統合分析結論為下午小睡可改善認知表現。

**來源**：
- Europe PMC 檢索（含 Dutheil 2021 摘要結論）：https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=(TITLE:%22nap%22%20OR%20TITLE:%22napping%22)%20AND%20TITLE:%22meta-analysis%22%20AND%20(TITLE:%22cognitive%22%20OR%20TITLE:%22performance%22)&resultType=core&format=json&pageSize=5

### 35. 無法確認的條目

以下說法本次未找到可直接支持或反駁的可信來源，建議遊戲中不要以醫學事實的口吻呈現：
- 「多喝水、當晚早睡即可止住」感冒初期症狀（見第 8 條，建議改為「降低惡化機率」）。
- 「感冒後未休息又熬夜會升級為發燒」的因果（見第 8 條，可作為遊戲抽象）。
- 「起身伸展可解除肩頸痠痛」（見第 15 條，建議改為「緩解」）。
- 咖啡因半衰期受避孕藥與懷孕影響的具體數字（只見於搜尋摘要）。
- 「肝臟幾乎沒有痛覺神經」（只見於搜尋摘要，見第 20 條）。
- 台灣政府機關專門針對「急性酒精中毒急救」的衛教頁面（已改以 NHS、NIAAA 與臺北榮總員山分院中毒處理單張支持）。

---

## 判定總表

| 編號 | 條目 | 判定 |
| --- | --- | --- |
| 1 | 電子菸法規 | 正確（需補法規內容） |
| 2 | 同學喝到叫不醒 | 正確但不完整 |
| 3 | 系際盃扭傷 | 過度簡化但可接受 |
| 4 | 校園流感疫苗 | 需修正 |
| 5 | 睡前滑手機 | 過度簡化但可接受 |
| 6 | 夜衝與疲勞騎車 | 過度簡化但可接受 |
| 7 | 腸胃炎與嚴重脫水 | 需修正 |
| 8 | 發燒與感冒升級規則 | 過度簡化但可接受（第 1、2 級措辭需修正） |
| 9 | 能量飲料與咖啡因上限 | 正確 |
| 10 | 系烤喝酒、勸酒 | 正確 |
| 11 | 情緒低落求助 | 正確 |
| 12 | 抗生素陷阱 | 正確（情境微調） |
| 13 | 全糖手搖飲倦怠 | 正確 |
| 14 | 宵夜與睡眠 | 過度簡化但可接受 |
| 15 | 久坐肩頸 | 過度簡化但可接受 |
| 16 | 新生健檢 | 正確 |
| 17 | 大腦血流與加派代幣 | 需修正（說法矛盾） |
| 18 | 胃 | 過度簡化但可接受 |
| 19 | 腸道菌 | 正確 |
| 20 | 肝病初期無症狀 | 正確 |
| 21 | 空腹肝臟維持血糖 | 正確 |
| 22 | 酒精代謝有上限 | 正確 |
| 23 | 過敏、長期壓力與免疫 | 正確 |
| 24 | 肌肉流失、運動益處 | 正確 |
| 25 | 腎臟需要水分 | 過度簡化但可接受 |
| 26 | 咖啡因半衰期 | 過度簡化但可接受 |
| 27 | 早餐翹班連鎖 | 正確 |
| 28 | 壓力螺旋 | 正確 |
| 29 | 酒精代謝速率與標準杯 | 過度簡化但可接受 |
| 30 | 抗生素陷阱連鎖 | 正確 |
| 31 | 空腹喝酒低血糖 | 建議新增 |
| 32 | 睡眠與感冒 4.2 倍 | 需修正 |
| 33 | 咖啡因耐受與戒斷 | 正確 |
| 34 | 短暫午睡 | 正確 |
| 35 | 無法確認清單 | 無法確認 |
