/* 图片翻译 - language helpers (browser + node) */
(function (root) {
  'use strict';

  const TARGET_ZH = 'zh-CN';
  const TARGET_EN = 'en';
  const BING_TO_ZH = 'zh-Hans';
  const BING_TO_EN = 'en';

  const OCR_LANG_JA = 'jpn+eng';
  const OCR_LANG_KO = 'kor+eng';
  const OCR_LANG_ZH_EN = 'eng+chi_sim';
  const OCR_PROBE_LANG = 'jpn+kor';

  // Characters that appear in only one of the two standard written forms.
  // Shared characters such as 你/好/是/的 are ignored. If there are no exclusive
  // markers, Chinese text is treated as Simplified (the user's exception case).
  const SIMP_ONLY = new Set(
    '爱办报备贝笔边变宾补参仓层产车彻尘陈衬称诚迟齿冲虫处触从达带单担胆党导灯敌递点电东动冻读断对队儿尔发范饭飞废费奋愤风缝妇复盖赶干钢个给关观广汉号后护划怀坏欢环会机积级计记济继价驾间艰检简减荐见将奖讲较节结仅紧进尽经惊举剧据克垦恳库况扩阔来兰蓝栏乐类离里礼历丽联练粮两疗辽邻灵龄领龙楼录陆驴乱论罗吗买麦门们梦面庙亩纳难恼脑农盘齐气迁签钱浅枪墙桥窃亲庆穷区驱权劝让扰热认荣虽扫杀伤烧设摄识时实势师湿适释数术帅双顺说丝肃随损摊坛叹汤讨誊体条听铜统头图涂团袜弯湾万网为卫务雾无习戏虾吓鲜闲显险县现线乡详响项须许绪续选压亚严颜盐杨扬养样钥页业医遗仪蚁艺阴隐应营拥优犹与屿语誉预员缘远愿跃运杂载赞赃脏枣灶则泽这针侦诊阵镇症证织职执纸质钟种肿众专转庄装壮准综总纵钻'
  );
  const TRAD_ONLY = new Set(
    '愛辦報備貝筆邊變賓補參倉層產車徹塵陳襯稱誠遲齒衝蟲處觸從達帶單擔膽黨導燈敵遞點電東動凍讀斷對隊兒爾發範飯飛廢費奮憤風縫婦復蓋趕幹鋼個給關觀廣漢號後護劃懷壞歡環會機積級計記濟繼價駕間艱檢簡減薦見將獎講較節結僅緊進盡經驚舉劇據剋墾懇庫況擴闊來蘭藍欄樂類離裡裏禮歷麗聯練糧兩療遼鄰靈齡領龍樓錄陸驢亂論羅嗎買麥門們夢麵廟畝納難惱腦農盤齊氣遷簽錢淺槍牆橋竊親慶窮區驅權勸讓擾熱認榮雖掃殺傷燒設攝識時實勢師濕適釋數術帥雙順說絲肅隨損攤壇嘆湯討謄體條聽銅統頭圖塗團襪彎灣萬網為衛務霧無習戲蝦嚇鮮閒顯險縣現線鄉詳響項須許緒續選壓亞嚴顏鹽楊揚養樣鑰頁業醫遺儀蟻藝陰隱應營擁優猶與嶼語譽預員緣遠願躍運雜載贊贓髒棗竈則澤這針偵診陣鎮症證織職執紙質鐘種腫眾專轉莊裝壯準綜總縱鑽國學過還開麼臺灣廳廠義戰寫黨齊龍龜鬱'
  );

  function countMarkers(text, set) {
    let n = 0;
    for (const ch of String(text || '')) {
      if (set.has(ch)) n += 1;
    }
    return n;
  }

  function countScripts(text) {
    const sample = String(text || '');
    const han = [];
    let letters = 0;
    let kana = 0;
    let hangul = 0;
    for (const ch of sample) {
      if (/\p{Script=Han}/u.test(ch)) {
        han.push(ch);
        letters += 1;
      } else if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(ch)) {
        kana += 1;
        letters += 1;
      } else if (/\p{Script=Hangul}/u.test(ch)) {
        hangul += 1;
        letters += 1;
      } else if (/\p{L}/u.test(ch)) {
        letters += 1;
      }
    }
    return { han, letters, kana, hangul, text: sample };
  }

  function isSimplifiedChineseSource(text) {
    const c = countScripts(text);
    // Japanese: any real hiragana/katakana means it is not Simplified Chinese.
    // Chinese text does not contain kana, so even 1–2 kana are decisive.
    if (c.kana >= 1) return false;
    // Korean: any real hangul means it is not Simplified Chinese, even when
    // the sentence also contains Han characters.
    if (c.hangul >= 1) return false;
    if (c.han.length === 0) return false;
    if (c.letters >= 8 && c.han.length / c.letters < 0.25) return false;
    const trad = countMarkers(c.text, TRAD_ONLY);
    const simp = countMarkers(c.text, SIMP_ONLY);
    if (trad > simp) return false;
    return true;
  }

  function resolveTargets(text) {
    if (isSimplifiedChineseSource(text)) {
      return { google: TARGET_EN, bing: BING_TO_EN };
    }
    return { google: TARGET_ZH, bing: BING_TO_ZH };
  }

  // Pick a Tesseract language pack from a downscaled probe. Two or more kana
  // (or a single kana that outnumbers hangul) means Japanese; the same rule
  // with hangul means Korean. Otherwise keep English + Simplified Chinese.
  function pickOcrLangFromProbe(text) {
    const c = countScripts(text);
    if (c.kana >= 2 || (c.kana >= 1 && c.kana > c.hangul)) return OCR_LANG_JA;
    if (c.hangul >= 2 || (c.hangul >= 1 && c.hangul > c.kana)) return OCR_LANG_KO;
    return OCR_LANG_ZH_EN;
  }

  const api = {
    TARGET_ZH,
    TARGET_EN,
    BING_TO_ZH,
    BING_TO_EN,
    OCR_LANG_JA,
    OCR_LANG_KO,
    OCR_LANG_ZH_EN,
    OCR_PROBE_LANG,
    countMarkers,
    countScripts,
    isSimplifiedChineseSource,
    resolveTargets,
    pickOcrLangFromProbe
  };

  root.CITLang = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
