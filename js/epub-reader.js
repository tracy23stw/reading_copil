/**
 * epub-reader.js — EPUB 翻页渲染模块
 * 
 * 使用 epub.js 以翻页模式渲染 EPUB，并在每页渲染后高亮人物名。
 */

class EpubReader {
  constructor(containerEl, options = {}) {
    this.container = containerEl;
    this.book = null;
    this.rendition = null;
    this.currentLocation = null;
    this.totalPages = 0;
    this.analyzer = options.analyzer || null;
    
    // 回调
    this.onPageChange = options.onPageChange || (() => {});
    this.onReady = options.onReady || (() => {});
    this.onCharacterClick = options.onCharacterClick || (() => {});
  }

  /**
   * 加载 EPUB 文件
   * @param {ArrayBuffer} arrayBuffer
   */
  async load(arrayBuffer) {
    console.log('[EpubReader] 加载 EPUB...');
    
    // 清除之前的内容
    if (this.book) {
      this.book.destroy();
    }
    this.container.innerHTML = '';
    
    // 创建 epub.js Book
    this.book = ePub(arrayBuffer);
    
    // 获取书籍元数据
    const metadata = await this.book.loaded.metadata;
    console.log('[EpubReader] 书名:', metadata.title);
    console.log('[EpubReader] 作者:', metadata.creator);
    
    // 渲染 — 翻页模式
    // 确保容器有尺寸
    let width = this.container.clientWidth;
    let height = this.container.clientHeight;
    if (width === 0) width = this.container.parentElement?.clientWidth || window.innerWidth;
    if (height === 0) height = (window.innerHeight - 140); // topbar + pagination
    
    console.log('[EpubReader] 渲染尺寸:', width, 'x', height);
    
    this.rendition = this.book.renderTo(this.container, {
      width: width,
      height: height,
      flow: 'paginated',
      spread: 'none', // 单页显示，适合竖屏iPad
      allowScriptedContent: true,
    });

    // 注入阅读样式
    this.rendition.themes.default({
      'body': {
        'font-family': "'Noto Serif SC', 'Songti SC', serif !important",
        'font-size': '16px !important',
        'line-height': '1.8 !important',
        'color': '#1F2121 !important',
        'background': '#F0F0ED !important',
        'padding': '20px 24px !important',
      },
      'p': {
        'margin-bottom': '0.8em !important',
        'text-indent': '2em !important',
      },
      'h1, h2, h3': {
        'font-family': "'Noto Serif SC', serif !important",
        'color': '#111111 !important',
        'text-indent': '0 !important',
      },
      '.character-name': {
        'color': '#395CC5 !important',
        'text-decoration': 'underline !important',
        'text-decoration-color': 'rgba(57, 92, 197, 0.3) !important',
        'text-underline-offset': '3px !important',
        'cursor': 'pointer !important',
      }
    });

    // 生成位置信息（用于百分比计算）
    await this.book.ready;
    try {
      this.locations = await this.book.locations.generate(1024);
      console.log('[EpubReader] 位置生成完成, 总位置数:', this.locations.length);
    } catch(e) {
      console.warn('[EpubReader] 位置生成失败:', e);
    }

    // 尝试从 localStorage 恢复进度
    const storageKey = `readingCopilot_progress_${metadata.title}`;
    const savedCfi = localStorage.getItem(storageKey) || localStorage.getItem('readingCopilot_latest_cfi');
    
    if (savedCfi) {
      console.log('[EpubReader] 恢复阅读进度:', savedCfi);
      await this.rendition.display(savedCfi);
    } else {
      // 显示第一页
      await this.rendition.display();
    }
    
    // 监听翻页事件
    this.rendition.on('relocated', (location) => {
      this.currentLocation = location;
      
      // 保存进度
      if (location && location.start && location.start.cfi) {
        localStorage.setItem(storageKey, location.start.cfi);
        localStorage.setItem('readingCopilot_latest_cfi', location.start.cfi);
      }
      
      this.onPageChange(location);
      
      // 每次翻页后高亮人物名
      setTimeout(() => this.highlightNames(), 100);
    });

    // 初始化后也高亮
    setTimeout(() => this.highlightNames(), 300);
    
    this.onReady({
      title: metadata.title,
      creator: metadata.creator,
    });
    
    return {
      title: metadata.title,
      creator: metadata.creator,
    };
  }

  /**
   * 提取全书文本（用于分析）
   */
  async extractAllText() {
    console.log('[EpubReader] 提取全书文本...');
    const chapters = [];
    
    const spine = this.book.spine;
    
    for (let i = 0; i < spine.items.length; i++) {
      const item = spine.items[i];
      
      try {
        const doc = await this.book.load(item.href);
        
        // 从 document 提取文本
        let text = '';
        let paragraphs = [];
        
        if (doc && doc.body) {
          // 获取所有段落元素
          const pElements = doc.body.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6');
          
          if (pElements.length > 0) {
            pElements.forEach(el => {
              const t = el.textContent.trim();
              if (t.length > 0) {
                paragraphs.push(t);
              }
            });
          } else {
            // fallback: 直接取 body 文本
            text = doc.body.textContent || '';
            paragraphs = text.split(/\n+/).map(p => p.trim()).filter(p => p.length > 0);
          }
          
          text = paragraphs.join('\n');
        }
        
        // 尝试获取章节标题
        let title = '';
        if (doc && doc.body) {
          const heading = doc.body.querySelector('h1, h2, h3, title');
          if (heading) {
            title = heading.textContent.trim();
          }
        }
        
        if (text.length > 0) {
          chapters.push({
            id: item.href,
            title: title || `章节 ${chapters.length + 1}`,
            text,
            paragraphs,
          });
        }
      } catch (e) {
        console.warn('[EpubReader] 跳过章节:', item.href, e.message);
      }
    }
    
    console.log('[EpubReader] 提取完成，共', chapters.length, '章');
    return chapters;
  }

  /**
   * 在当前页面高亮人物名
   */
  highlightNames() {
    if (!this.analyzer || !this.rendition) return;
    
    try {
      const contents = this.rendition.getContents();
      
      contents.forEach(content => {
        const doc = content.document;
        if (!doc || !doc.body) return;
        
        // 获取 body 下的所有文本节点
        const walker = doc.createTreeWalker(
          doc.body,
          NodeFilter.SHOW_TEXT,
          null,
          false
        );

        const textNodes = [];
        let node;
        while (node = walker.nextNode()) {
          // 跳过已经处理过的节点
          if (node.parentElement && node.parentElement.classList &&
              node.parentElement.classList.contains('character-name')) {
            continue;
          }
          if (node.textContent.trim().length > 0) {
            textNodes.push(node);
          }
        }

        // 获取所有人物名
        const allNames = Object.keys(this.analyzer.characters);
        // 按长度降序，优先匹配长名字
        allNames.sort((a, b) => b.length - a.length);

        for (const textNode of textNodes) {
          const text = textNode.textContent;
          let hasMatch = false;
          
          for (const name of allNames) {
            if (text.includes(name)) {
              hasMatch = true;
              break;
            }
          }
          
          if (!hasMatch) continue;

          // 替换文本节点
          const fragment = doc.createDocumentFragment();
          let remaining = text;
          
          while (remaining.length > 0) {
            let earliestMatch = null;
            let earliestIndex = remaining.length;
            
            for (const name of allNames) {
              const idx = remaining.indexOf(name);
              if (idx !== -1 && idx < earliestIndex) {
                earliestIndex = idx;
                earliestMatch = name;
              }
            }
            
            if (earliestMatch === null) {
              fragment.appendChild(doc.createTextNode(remaining));
              break;
            }
            
            // 前面的普通文本
            if (earliestIndex > 0) {
              fragment.appendChild(doc.createTextNode(remaining.substring(0, earliestIndex)));
            }
            
            // 人物名高亮
            const span = doc.createElement('span');
            span.className = 'character-name';
            span.textContent = earliestMatch;
            span.setAttribute('data-character', earliestMatch);
            span.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              this.onCharacterClick(earliestMatch);
            });
            fragment.appendChild(span);
            
            remaining = remaining.substring(earliestIndex + earliestMatch.length);
          }
          
          textNode.parentNode.replaceChild(fragment, textNode);
        }
      });
    } catch (e) {
      console.warn('[EpubReader] 高亮人物名时出错:', e);
    }
  }

  /**
   * 翻到下一页
   */
  async next() {
    if (this.rendition) {
      await this.rendition.next();
    }
  }

  /**
   * 翻到上一页
   */
  async prev() {
    if (this.rendition) {
      await this.rendition.prev();
    }
  }

  /**
   * 获取页面信息
   */
  getPageInfo() {
    if (!this.currentLocation) return { current: 0, total: 0, percentage: 0 };
    
    const loc = this.currentLocation;
    const start = loc.start;
    
    // 计算百分比
    let percentage = 0;
    if (start && start.percentage !== undefined && start.percentage !== null) {
      percentage = Math.round(start.percentage * 100);
    } else if (this.book && this.book.locations && start && start.cfi) {
      percentage = this.book.locations.percentageFromCfi(start.cfi);
      percentage = Math.round((percentage || 0) * 100);
    }
    
    // 获取章节标题
    let chapterTitle = '';
    if (this.book && this.book.navigation && start && start.href) {
      const navItem = this.book.navigation.get(start.href);
      if (navItem) {
        chapterTitle = navItem.label;
      } else {
        const baseHref = start.href.split('#')[0];
        this.book.navigation.forEach(nav => {
           if (nav.href && nav.href.split('#')[0] === baseHref) {
             chapterTitle = nav.label;
           }
        });
      }
    }
    
    return {
      current: start?.displayed?.page || 0,
      total: start?.displayed?.total || 0,
      chapter: start?.index || 0,
      percentage: percentage,
      chapterTitle: chapterTitle ? chapterTitle.trim() : ''
    };
  }

  /**
   * 跳转到指定百分比
   */
  async jumpToPercentage(percentage) {
    if (!this.book || !this.book.locations) return;
    
    let clamped = parseFloat(percentage);
    if (isNaN(clamped)) return;
    if (clamped < 0) clamped = 0;
    if (clamped > 100) clamped = 100;
    
    const cfi = this.book.locations.cfiFromPercentage(clamped / 100);
    if (cfi && this.rendition) {
      await this.rendition.display(cfi);
    }
  }

  /**
   * 调整尺寸（窗口变化时）
   */
  resize() {
    if (this.rendition) {
      const width = this.container.clientWidth;
      const height = this.container.clientHeight;
      this.rendition.resize(width, height);
    }
  }

  /**
   * 销毁
   */
  destroy() {
    if (this.book) {
      this.book.destroy();
      this.book = null;
      this.rendition = null;
    }
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = EpubReader;
}
