/**
 * analyzer.js — 人物提取与段落召回
 * 
 * 从 EPUB 全文中识别人物名，收集相关段落，生成人物档案。
 */

class TextAnalyzer {
  constructor() {
    // 分析结果
    this.characters = {};  // { name: CharacterProfile }
    this.allParagraphs = []; // [{ chapter, chapterTitle, text }]
    
    // 中文人物上下文标志词（出现在人名前后，增加该候选词是人名的可信度）
    this.contextClues = [
      // 对话标志
      '说', '道', '问', '答', '叫', '喊', '嚷', '嘀咕', '低声', '大声',
      '笑', '哭', '叹', '吼',
      // 动作标志  
      '看', '望', '想', '听', '走', '跑', '站', '坐', '躺',
      '拿', '拉', '推', '抱', '打', '摸', '握',
      // 情感/状态
      '觉得', '认为', '知道', '明白', '害怕', '高兴', '生气', '伤心',
      // 称谓前缀
      '老', '小', '大',
      // 关系词
      '和', '跟', '对', '给', '把', '被', '让', '叫',
    ];
    
    // 常见非人名的高频词（排除列表）
    this.stopWords = new Set([
      // 代词/指示词
      '什么', '这个', '那个', '自己', '他们', '她们', '我们', '大家',
      '这些', '那些', '哪些', '某些', '谁的',
      // 时间/地点通用词
      '时候', '地方', '事情', '东西', '怎么', '这样', '那样', '一个',
      '今天', '明天', '昨天', '现在', '后来', '当时', '之前', '那天',
      '那年', '这次', '上午', '下午', '晚上', '早上', '白天', '夜里',
      // 连接词/副词
      '不是', '没有', '可以', '已经', '因为', '所以', '如果', '但是',
      '还是', '或者', '而且', '虽然', '然后', '之后', '以后', '以前',
      '知道', '觉得', '认为', '希望', '开始', '起来', '出来', '回来',
      '上去', '下来', '过来', '过去', '一样', '一起', '一直', '一定',
      '只是', '就是', '不过', '也许', '终于', '突然', '其实', '当然',
      '可能', '应该', '必须', '似乎', '仿佛', '好像', '果然', '居然',
      '竟然', '到底', '究竟', '简直', '实在', '确实', '显然', '一些',
      '这里', '那里', '哪里',
      '第一', '第二', '第三', '第四', '第五', '所有', '每个', '任何',
      '有些', '很多', '非常', '十分', '特别', '真的', '真是', '的确',
      // 常见通用名词（容易误判为人名）
      '妈妈', '爸爸', '爷爷', '奶奶', '哥哥', '姐姐', '弟弟', '妹妹',
      '叔叔', '阿姨', '孩子', '女孩', '男孩', '女人', '男人', '老人',
      '先生', '太太', '小姐', '夫人', '丈夫', '妻子', '父亲', '母亲',
      '儿子', '女儿', '朋友', '邻居', '医生', '护士', '警察', '老师',
      // 常见地名词缀/通用地名词/测试发现的特定地名
      '马州', '加州', '纽约', '美国', '中国', '日本', '英国', '法国',
      '咖啡馆', '餐厅', '教堂', '医院', '学校', '商店', '车站', '公园',
      '养老院', '玫瑰', '花园', '伯明翰', '汽笛镇', '亚拉巴',
      // 情感/动作类误报
      '亲爱的', '我想', '我说', '她说', '他说', '他们说',
      '对不起', '谢谢', '没关系', '当然了', '怎么了',
      '喜欢', '讨厌', '愿意', '同意', '反对', '你知道', '是不是', '我只是',
      // 常见2字动词/形容词
      '看到', '听到', '想到', '来到', '回到', '走到', '感到',
      '变得', '成为', '属于', '关于', '对于',
      '漂亮', '美丽', '可爱', '善良', '聪明',
      // 特定小说碎片词（油炸绿番茄）
      '周报', '瑰露台养', '玫瑰露', '台养老',
    ]);
  }

  /**
   * 分析书籍全文 (Hybrid Pipeline: 本地粗筛 + LLM 清洗)
   * @param {Array} chapters - [{ id, title, text, paragraphs }]
   * @param {String} bookTitle - 书名
   * @returns {Object} { characters, relationships }
   */
  async analyze(chapters, bookTitle) {
    console.log('[Analyzer] 开始本地粗筛，共', chapters.length, '章');
    
    // 1. 收集所有段落
    this.collectParagraphs(chapters);
    
    // 2. 提取候选人名
    const candidates = this.extractCandidateNames();
    console.log('[Analyzer] 候选人名初步选出:', candidates.length, '个');
    
    // 3. 上下文验证 (本地过滤掉非常明显的非人名)
    let verified = this.verifyWithContext(candidates);
    
    // 截取前 50 个发送给 LLM（避免发太多垃圾数据）
    verified = verified.slice(0, 50);
    
    // 为每个候选人准备上下文样本（发给 LLM 摘要用）
    const payloadCandidates = verified.map(v => {
      // 找出该人物出现的所有段落
      const relatedParagraphs = this.allParagraphs.filter(p => p.text.includes(v.name));
      
      // 随机抽取 5 段较长的上下文作为样本
      const samples = relatedParagraphs
        .filter(p => p.text.length > 20)
        .sort(() => 0.5 - Math.random())
        .slice(0, 5)
        .map(p => p.text);
        
      return {
        name: v.name,
        count: relatedParagraphs.length,
        samples: samples.length > 0 ? samples : relatedParagraphs.slice(0, 3).map(p => p.text)
      };
    });

    console.log('[Analyzer] 准备请求 LLM...');
    
    try {
      const llmClient = new (typeof LLMClient !== 'undefined' ? LLMClient : require('./llm-client'))();
      const llmResult = await llmClient.processCharacters(payloadCandidates, bookTitle);
      
      // 4. 重建 characters 字典 (基于 LLM 的干净结果)
      this.rebuildCharactersFromLLM(llmResult.characters, chapters, llmResult.relationships);
      
      this.relationships = llmResult.relationships || [];
      this.families = llmResult.families || [];
      
      console.log('[Analyzer] 最终构建人物档案:', Object.keys(this.characters).length, '个');
      return { 
        characters: this.characters, 
        relationships: this.relationships,
        families: this.families 
      };
      
    } catch (err) {
      console.error('[Analyzer] LLM 处理失败，回退到本地纯净模式', err);
      // Fallback: 纯本地构建
      this.buildProfiles(verified.slice(0, 20), chapters);
      this.relationships = [];
      this.families = [];
      return { characters: this.characters, relationships: [], families: [] };
    }
  }

  /**
   * 收集所有段落（带章节信息）
   */
  collectParagraphs(chapters) {
    this.allParagraphs = [];
    chapters.forEach((chapter, idx) => {
      const paragraphs = chapter.paragraphs || [chapter.text];
      paragraphs.forEach(p => {
        const text = p.trim();
        if (text.length > 0) {
          this.allParagraphs.push({
            chapter: idx,
            chapterTitle: chapter.title || `第${idx + 1}章`,
            text: text
          });
        }
      });
    });
  }

  /**
   * 提取候选人名
   * 策略：提取 2-4 字的高频词组，排除常见词
   */
  extractCandidateNames() {
    // 合并全文
    const fullText = this.allParagraphs.map(p => p.text).join('\n');
    
    // 提取 2-4 字组合的出现频率
    const freqMap = {};
    
    // 匹配中文 2-4 字词组
    // 人名特征：通常 2-3 个汉字，翻译小说可能更长
    const patterns = [
      /[\u4e00-\u9fa5]{2,4}/g, // 基础中文词组
    ];
    
    // 使用引号内的名字作为强候选
    const quotedNamePattern = /[""「]([^""」]{1,10})[""」]\s*[说道问答叫喊]/g;
    let match;
    while ((match = quotedNamePattern.exec(fullText)) !== null) {
      // 引号前通常有人名
    }

    // 扫描每个段落，寻找上下文标志词附近的词组
    for (const para of this.allParagraphs) {
      const text = para.text;
      
      // 方法1：在"说"、"道"等标志词前找名字
      for (const clue of this.contextClues) {
        const pattern = new RegExp(`([\\u4e00-\\u9fa5]{2,6})${clue}`, 'g');
        let m;
        while ((m = pattern.exec(text)) !== null) {
          const candidate = m[1];
          // 取最后2-4个字作为名字（如"伊吉说" → "伊吉"）
          const name = candidate.length > 4 ? candidate.slice(-4) : candidate;
          if (!this.stopWords.has(name) && name.length >= 2) {
            freqMap[name] = (freqMap[name] || 0) + 1;
          }
        }
      }
      
      // 方法2：直接统计2-3字词组频率
      const words = text.match(/[\u4e00-\u9fa5]{2,3}/g) || [];
      for (const word of words) {
        if (!this.stopWords.has(word)) {
          freqMap[word] = (freqMap[word] || 0) + 1;
        }
      }
    }

    // 排序并取高频词
    const sorted = Object.entries(freqMap)
      .filter(([name, count]) => count >= 5) // 至少出现5次
      .sort((a, b) => b[1] - a[1]);

    // 返回候选列表（最多取前100个）
    return sorted.slice(0, 100).map(([name, count]) => ({ name, count }));
  }

  /**
   * 上下文验证：确认候选词确实是人名
   */
  verifyWithContext(candidates) {
    const verified = [];
    const fullText = this.allParagraphs.map(p => p.text).join('\n');
    
    for (const { name, count } of candidates) {
      let score = 0;
      
      // 规则1：出现在"X说"、"X想"等结构中（+3分）
      for (const clue of ['说', '道', '想', '问', '笑', '看']) {
        const pattern = new RegExp(name + clue, 'g');
        const matches = fullText.match(pattern);
        if (matches) {
          score += matches.length * 3;
        }
      }
      
      // 规则2：出现在引号后面/前面（+2分）
      const quotePattern = new RegExp(`[""」]\\s*${name}|${name}\\s*[""「]`, 'g');
      const quoteMatches = fullText.match(quotePattern);
      if (quoteMatches) {
        score += quoteMatches.length * 2;
      }
      
      // 规则3：与其他已验证的人物共现（+1分）
      // 跳过，在后续分析中处理
      
      // 规则4：纯动词/形容词排除（-10分）
      const verbPatterns = ['正在', '已经', '开始', '继续', '停止'];
      for (const vp of verbPatterns) {
        if (name.includes(vp)) score -= 10;
      }
      
      // 规则5：高频出现本身也是信号
      if (count >= 20) score += 5;
      if (count >= 50) score += 10;
      
      // 阈值判断
      if (score >= 3 && count >= 5) {
        verified.push({ name, count, score });
      }
    }
    
    // 去重：如果 "伊吉" 和 "伊吉丝" 都在，只保留更高频的
    const deduped = this.deduplicateNames(verified);
    
    // 按分数排序
    return deduped.sort((a, b) => b.score - a.score).slice(0, 30);
  }

  /**
   * 去重：处理同一人物的不同称呼
   */
  deduplicateNames(names) {
    const result = [];
    const used = new Set();
    
    // 按频率排序，优先保留高频的
    const sorted = [...names].sort((a, b) => b.count - a.count);
    
    for (const item of sorted) {
      let isDuplicate = false;
      
      for (const existing of result) {
        // 如果一个名字包含另一个
        if (item.name.includes(existing.name) || existing.name.includes(item.name)) {
          isDuplicate = true;
          // 保留更高频的
          break;
        }
      }
      
      if (!isDuplicate && !used.has(item.name)) {
        result.push(item);
        used.add(item.name);
      }
    }
    
    return result;
  }

  /**
   * 基于 LLM 结果重建人物档案
   */
  rebuildCharactersFromLLM(llmCharacters, chapters, llmRelationships = []) {
    this.characters = {};
    
    // 构建别名到主名的映射表
    this.aliasMap = {};
    
    for (const char of llmCharacters) {
      const name = char.primaryName;
      
      // 记录别名映射
      this.aliasMap[name] = name;
      if (char.aliases && Array.isArray(char.aliases)) {
        char.aliases.forEach(alias => {
          this.aliasMap[alias] = name;
        });
      }
      
      // 找出该人物及其所有别名出现的段落
      const searchNames = [name, ...(char.aliases || [])];
      let totalCount = 0;
      const chapterAppearances = new Set();
      
      for (const para of this.allParagraphs) {
        let hasMatch = false;
        for (const sn of searchNames) {
          if (para.text.includes(sn)) {
            hasMatch = true;
            break;
          }
        }
        if (hasMatch) {
          totalCount++;
          chapterAppearances.add(para.chapter);
        }
      }
      
      const firstChapter = chapterAppearances.size > 0 ? Math.min(...chapterAppearances) : 0;
      
      // 提取个人关系
      const relatedSet = new Set();
      llmRelationships.forEach(rel => {
        if (rel.source === name) relatedSet.add(`${rel.target} (${rel.relation})`);
        if (rel.target === name) relatedSet.add(`${rel.source} (${rel.relation})`);
      });
      
      this.characters[name] = {
        name,
        aliases: char.aliases || [],
        count: totalCount,
        firstChapter,
        firstChapterTitle: chapters[firstChapter]?.title || `第${firstChapter + 1}章`,
        chapterAppearances: [...chapterAppearances].sort((a, b) => a - b),
        summary: char.summary,
        tags: [], // 等待统一计算
        related: Array.from(relatedSet)
      };
    }
    
    // 动态计算相对词频来打标签
    const charArray = Object.values(this.characters);
    if (charArray.length > 0) {
      const maxCount = Math.max(...charArray.map(c => c.count));
      
      charArray.forEach(char => {
        let tag = '次要人物';
        // 第一梯队：出现次数大于最高频次数的 40%
        if (char.count >= maxCount * 0.4) tag = '主角';
        // 第二梯队：出现次数大于最高频次数的 10%
        else if (char.count >= maxCount * 0.1) tag = '主要人物';
        
        char.tags.push(tag);
      });
    }
  }

  /**
   * 本地 Fallback 为每个人物构建档案 (LLM失败时使用)
   */
  buildProfiles(verifiedNames, chapters) {
    this.characters = {};
    
    for (const { name, count, score } of verifiedNames) {
      // 找出该人物出现的所有段落
      const relatedParagraphs = [];
      const chapterAppearances = new Set();
      
      for (const para of this.allParagraphs) {
        if (para.text.includes(name)) {
          relatedParagraphs.push(para);
          chapterAppearances.add(para.chapter);
        }
      }
      
      // 找出共现最多的其他人物
      const coOccurrences = {};
      for (const vn of verifiedNames) {
        if (vn.name === name) continue;
        let coCount = 0;
        for (const para of relatedParagraphs) {
          if (para.text.includes(vn.name)) {
            coCount++;
          }
        }
        if (coCount > 0) {
          coOccurrences[vn.name] = coCount;
        }
      }
      
      // 排序共现人物
      const related = Object.entries(coOccurrences)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([n]) => n);
      
      // 生成摘要（取第一个包含人名的段落的前100字）
      let summary = '';
      if (relatedParagraphs.length > 0) {
        // 找到第一段有描述性内容的段落
        for (const p of relatedParagraphs) {
          if (p.text.length > 20 && !p.text.startsWith('"') && !p.text.startsWith('"')) {
            summary = p.text.substring(0, 120) + (p.text.length > 120 ? '……' : '');
            break;
          }
        }
        if (!summary) {
          summary = relatedParagraphs[0].text.substring(0, 120) + '……';
        }
      }
      
      // 找首次出场章节
      const firstChapter = chapterAppearances.size > 0
        ? Math.min(...chapterAppearances)
        : 0;
      
      this.characters[name] = {
        name,
        count: relatedParagraphs.length,
        score,
        firstChapter,
        firstChapterTitle: chapters[firstChapter]?.title || `第${firstChapter + 1}章`,
        chapterAppearances: [...chapterAppearances].sort((a, b) => a - b),
        summary,
        related,
        tags: this.generateTags(name, relatedParagraphs),
      };
    }
  }

  /**
   * 自动生成人物标签
   */
  generateTags(name, paragraphs) {
    const tags = [];
    const allText = paragraphs.map(p => p.text).join(' ');
    
    // 出场频率标签
    if (paragraphs.length >= 30) tags.push('主要人物');
    else if (paragraphs.length >= 10) tags.push('重要人物');
    else tags.push('次要人物');
    
    // 首次出场
    if (paragraphs.length > 0) {
      tags.push(paragraphs[0].chapterTitle);
    }
    
    return tags;
  }

  /**
   * 获取指定人物的档案（支持别名解析）
   */
  getCharacter(name) {
    // 如果有 aliasMap，先找主名
    if (this.aliasMap && this.aliasMap[name]) {
      return this.characters[this.aliasMap[name]] || null;
    }
    return this.characters[name] || null;
  }

  /**
   * 获取所有人物列表（按出场频率排序）
   */
  getAllCharacters() {
    return Object.values(this.characters)
      .sort((a, b) => b.count - a.count);
  }

  /**
   * 获取当前页文本中的所有人物名（包含所有别名）
   */
  findNamesInText(text) {
    const found = [];
    
    // 如果有 alias 映射，用映射表里的所有名字去匹配
    const namesToSearch = this.aliasMap ? Object.keys(this.aliasMap) : Object.keys(this.characters);
    
    for (const name of namesToSearch) {
      if (text.includes(name)) {
        found.push(name);
      }
    }
    // 按名字长度降序排列（优先匹配长名字）
    return found.sort((a, b) => b.length - a.length);
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TextAnalyzer;
}
