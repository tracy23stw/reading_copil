/**
 * app.js — 主控制器
 * 
 * 协调 EPUB 阅读器和文本分析器，管理 UI 状态。
 */

class App {
  constructor() {
    this.reader = null;
    this.analyzer = new TextAnalyzer();
    this.currentCharacter = null;
    this.bookMeta = null;
    
    // DOM 引用
    this.els = {};
    
    this.init();
  }

  init() {
    // 缓存 DOM 元素
    this.els = {
      app: document.getElementById('app'),
      fileInput: document.getElementById('file-input'),
      fileInputUpload: document.getElementById('file-input-upload'),
      epubViewer: document.getElementById('epub-viewer'),
      emptyState: document.getElementById('empty-state'),
      readerPane: document.getElementById('reader-pane'),
      characterPanel: document.getElementById('character-panel'),
      panelName: document.getElementById('panel-name'),
      panelStats: document.getElementById('panel-stats'),
      panelSummary: document.getElementById('panel-summary'),
      panelTags: document.getElementById('panel-tags'),
      panelRelated: document.getElementById('panel-related'),
      panelClose: document.getElementById('panel-close'),
      btnPrev: document.getElementById('btn-prev'),
      btnNext: document.getElementById('btn-next'),
      progressInput: document.getElementById('progress-input'),
      chapterInfo: document.getElementById('chapter-info'),
      pagination: document.getElementById('pagination'),
      bookTitle: document.getElementById('book-title'),
      loadingState: document.getElementById('loading-state'),
      navLinks: document.querySelectorAll('.nav-link'),
      viewReader: document.getElementById('view-reader') || document.getElementById('reader-pane'),
      viewCharacters: document.getElementById('view-characters'),
      viewGraph: document.getElementById('view-graph'),
      charactersGrid: document.getElementById('characters-grid'),
      emptyStateCharacters: document.getElementById('empty-state-characters'),
      emptyStateGraph: document.getElementById('empty-state-graph'),
      
      // Modal for characters
      modalOverlay: document.getElementById('modal-overlay'),
      modalName: document.getElementById('modal-name'),
      modalStats: document.getElementById('modal-stats'),
      modalTags: document.getElementById('modal-tags'),
      modalSummary: document.getElementById('modal-summary'),
      modalRelated: document.getElementById('modal-related'),
      modalChapters: document.getElementById('modal-chapters'),
    };

    // 绑定事件
    this.bindEvents();
    
    console.log('[App] 初始化完成');
    
    // 尝试加载缓存的书籍
    this.tryLoadCachedBook();
  }

  async tryLoadCachedBook() {
    if (typeof localforage === 'undefined') return;
    try {
      const cachedBuffer = await localforage.getItem('cached_epub');
      if (cachedBuffer) {
        console.log('[App] 发现本地缓存的书籍，自动恢复...');
        await this.loadEpubBuffer(cachedBuffer);
      }
    } catch (e) {
      console.warn('[App] 读取书籍缓存失败:', e);
    }
  }

  bindEvents() {
    // 文件选择
    this.els.fileInput?.addEventListener('change', (e) => this.handleFile(e));
    this.els.fileInputUpload?.addEventListener('change', (e) => this.handleFile(e));

    // 翻页按钮
    this.els.btnPrev?.addEventListener('click', () => this.prevPage());
    this.els.btnNext?.addEventListener('click', () => this.nextPage());

    // 关闭人物面板
    this.els.panelClose?.addEventListener('click', () => this.closePanel());

    // 键盘翻页
    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') this.prevPage();
      if (e.key === 'ArrowRight') this.nextPage();
      if (e.key === 'Escape') this.closePanel();
    });

    // 输入百分比跳转
    this.els.progressInput?.addEventListener('change', (e) => this.handleProgressInput(e));
    this.els.progressInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.els.progressInput.blur();
        this.handleProgressInput(e);
      }
    });

    // 主动保存阅读进度
    window.addEventListener('beforeunload', () => this.saveCurrentProgress());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.saveCurrentProgress();
      }
    });

    // 导航栏视图切换
    this.els.navLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const view = link.getAttribute('data-view');
        if (view) {
          this.switchView(view);
        }
      });
    });

    // 关闭人物详情模态框
    if (this.els.modalOverlay) {
      this.els.modalOverlay.addEventListener('click', (e) => {
        if (e.target === this.els.modalOverlay) this.closeCharacterModal();
      });
    }
  }

  /**
   * 保存当前阅读进度
   */
  saveCurrentProgress() {
    if (this.reader && this.reader.currentLocation && this.reader.currentLocation.start.cfi) {
      const cfi = this.reader.currentLocation.start.cfi;
      const title = this.bookMeta ? this.bookMeta.title : 'unknown';
      localStorage.setItem(`readingCopilot_progress_${title}`, cfi);
      localStorage.setItem('readingCopilot_latest_cfi', cfi);
      console.log('[App] 进度已保存:', cfi);
    }
  }

  /**
   * 处理文件选择
   */
  async handleFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (!file.name.endsWith('.epub')) {
      alert('请选择 .epub 格式的文件');
      return;
    }

    console.log('[App] 加载文件:', file.name);
    
    // 显示加载状态

    try {
      // 读取文件为 ArrayBuffer
      const arrayBuffer = await this.readFileAsArrayBuffer(file);
      
      // 存入 IndexedDB 缓存
      if (typeof localforage !== 'undefined') {
        await localforage.setItem('cached_epub', arrayBuffer);
      }
      
      await this.loadEpubBuffer(arrayBuffer);
    } catch (error) {
      console.error('[App] 加载失败:', error);
      alert('文件加载失败，请检查是否为有效的 EPUB 格式');
      this.showEmpty();
    }
  }

  /**
   * 加载 EPUB 二进制数据
   */
  async loadEpubBuffer(arrayBuffer) {
    this.showLoading();
    try {
      // *** 关键：先显示阅读界面，确保容器有尺寸 ***
      this.showReader();
      
      // 等一帧让 DOM 更新
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      
      // 创建阅读器
      this.reader = new EpubReader(this.els.epubViewer, {
        analyzer: this.analyzer,
        onPageChange: (location) => this.handlePageChange(location),
        onReady: (meta) => this.handleBookReady(meta),
        onCharacterClick: (name) => this.showCharacterPanel(name),
      });

      // 加载 EPUB（容器现在有尺寸了）
      const meta = await this.reader.load(arrayBuffer);
      this.bookMeta = meta;

      // 1. 计算文件指纹 (SHA-256)
      const fileHash = await this.computeHash(arrayBuffer);
      console.log('[App] 文件指纹 (SHA-256):', fileHash);

      // 2. 检查是否有分析缓存
      let analysisResult = null;
      try {
        console.log('[App] 正在检查云端缓存...');
        const response = await fetch(`/api/cache?hash=${fileHash}`);
        if (response.ok) {
          analysisResult = await response.json();
          console.log('[App] 命中云端缓存！实现全网秒开。');
        }
      } catch (err) {
        console.warn('[App] 检查云端缓存失败, 退回到本地缓存:', err);
      }

      // 如果云端没有，尝试本地 IndexedDB (向下兼容)
      if (!analysisResult && typeof localforage !== 'undefined') {
        analysisResult = await localforage.getItem(`cached_analysis_${fileHash}`);
      }

      if (!analysisResult) {
        // 提取全书文本并分析（后台进行，不阻塞阅读）
        console.log('[App] 开始调用大模型进行分析...');
        const chapters = await this.reader.extractAllText();
        analysisResult = await this.analyzer.analyze(chapters, meta.title);
        console.log('[App] 分析完成，识别核心人物:', Object.keys(analysisResult.characters).length);
        
        // 异步保存到云端
        try {
          console.log('[App] 正在将分析结果同步至全网云端...');
          fetch('/api/cache', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hash: fileHash, data: analysisResult })
          });
        } catch (e) {
          console.warn('[App] 同步至云端失败:', e);
        }

        // 存入本地缓存
        if (typeof localforage !== 'undefined') {
          await localforage.setItem(`cached_analysis_${fileHash}`, analysisResult);
        }
      } else {
        console.log('[App] 发现有效缓存，直接恢复数据');
        this.analyzer.characters = analysisResult.characters;
        this.analyzer.relationships = analysisResult.relationships;
        this.analyzer.families = analysisResult.families || [];
      }
      
      // 保存所有数据到 sessionStorage，供其他页面（图谱、总览）使用
      sessionStorage.setItem('readingCopilot_relationships', JSON.stringify(analysisResult.relationships));
      sessionStorage.setItem('readingCopilot_families', JSON.stringify(analysisResult.families || []));
      sessionStorage.setItem('readingCopilot_characters', JSON.stringify(this.analyzer.getAllCharacters()));
      sessionStorage.setItem('readingCopilot_bookTitle', meta.title);
      
      // 高亮当前页的人物名
      setTimeout(() => {
        this.reader.highlightNames();
      }, 300);

    } catch (error) {
      console.error('[App] 书籍渲染或分析失败:', error);
      alert('书籍渲染失败');
      this.showEmpty();
    }
  }

  /**
   * 读取文件为 ArrayBuffer
   */
  readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * 计算 ArrayBuffer 的 SHA-256 指纹
   */
  async computeHash(arrayBuffer) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
  }

  /**
   * EPUB 加载就绪
   */
  handleBookReady(meta) {
    console.log('[App] 书籍就绪:', meta.title);
    if (this.els.bookTitle) {
      this.els.bookTitle.textContent = `《${meta.title}》`;
      this.els.bookTitle.style.display = 'block';
    }
  }

  /**
   * 翻页回调
   */
  handlePageChange(location) {
    // 关闭人物面板
    this.closePanel();
    
    // 更新页码
    this.updatePageInfo();
  }

  /**
   * 更新页码显示
   */
  updatePageInfo() {
    if (!this.reader) return;
    const info = this.reader.getPageInfo();
    
    if (this.els.progressInput) {
      this.els.progressInput.value = info.percentage;
    }
    if (this.els.chapterInfo) {
      this.els.chapterInfo.textContent = info.chapterTitle;
      this.els.chapterInfo.title = info.chapterTitle; // tooltip
    }
  }

  /**
   * 处理进度输入跳转
   */
  async handleProgressInput(event) {
    const val = this.els.progressInput.value;
    if (val !== '') {
      await this.reader.jumpToPercentage(val);
    }
  }

  /**
   * 上一页
   */
  async prevPage() {
    if (this.reader) {
      await this.reader.prev();
    }
  }

  /**
   * 下一页
   */
  async nextPage() {
    if (this.reader) {
      await this.reader.next();
    }
  }

  /**
   * 显示人物面板
   */
  showCharacterPanel(name) {
    const character = this.analyzer.getCharacter(name);
    if (!character) return;

    this.currentCharacter = name;

    // 填充面板内容
    this.els.panelName.textContent = character.name;
    
    // 统计
    this.els.panelStats.innerHTML = `
      <span class="stat-badge stat-badge--blue">出场 ${character.count} 次</span>
      <span class="stat-badge">${character.firstChapterTitle}</span>
    `;

    // 摘要
    this.els.panelSummary.textContent = character.summary || '暂无摘要';

    // 标签
    this.els.panelTags.innerHTML = character.tags
      .map(t => `<span class="tag">${t}</span>`)
      .join('');

    // 关联人物
    if (character.related.length > 0) {
      this.els.panelRelated.innerHTML = character.related
        .map(r => `<li><span class="name">${r}</span></li>`)
        .join('');
      
      // 绑定关联人物的点击事件
      this.els.panelRelated.querySelectorAll('li').forEach(li => {
        li.addEventListener('click', () => {
          const relName = li.querySelector('.name').textContent;
          this.showCharacterPanel(relName);
        });
      });
    } else {
      this.els.panelRelated.innerHTML = '<li style="color: var(--color-text-muted)">暂无</li>';
    }

    // 打开面板
    this.els.characterPanel.classList.add('open');
  }

  /**
   * 关闭人物面板
   */
  closePanel() {
    this.els.characterPanel?.classList.remove('open');
    this.currentCharacter = null;
  }

  /**
   * 切换视图 (阅读 / 人物总览 / 关系图谱)
   */
  switchView(viewName) {
    // 隐藏所有视图
    if (this.els.viewReader) this.els.viewReader.style.display = 'none';
    if (this.els.viewCharacters) this.els.viewCharacters.style.display = 'none';
    if (this.els.viewGraph) this.els.viewGraph.style.display = 'none';
    if (this.els.pagination) this.els.pagination.style.display = 'none';
    
    // 如果离开阅读页，保存进度
    if (viewName !== 'reader') {
      this.saveCurrentProgress();
    }

    // 更新高亮状态
    this.els.navLinks.forEach(link => {
      if (link.getAttribute('data-view') === viewName) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });

    // 只有在没有加载书籍时，才显示主空状态
    if (!this.reader && viewName === 'reader') {
      this.showEmpty();
      return;
    } else {
      if (this.els.emptyState) this.els.emptyState.style.display = 'none';
    }

    if (viewName === 'reader') {
      if (this.els.viewReader) this.els.viewReader.style.display = 'flex';
      if (this.els.pagination) this.els.pagination.style.display = 'flex';
      this.updatePageInfo();
    } else if (viewName === 'characters') {
      if (this.els.viewCharacters) this.els.viewCharacters.style.display = 'block';
      this.renderCharactersView();
    } else if (viewName === 'graph') {
      if (this.els.viewGraph) this.els.viewGraph.style.display = 'block';
      this.renderGraphView();
    }
  }

  renderCharactersView() {
    const characters = this.analyzer.getAllCharacters();
    if (!characters || characters.length === 0) {
      if (this.els.emptyStateCharacters) this.els.emptyStateCharacters.style.display = 'flex';
      if (this.els.charactersGrid) this.els.charactersGrid.style.display = 'none';
      return;
    }
    
    if (this.els.emptyStateCharacters) this.els.emptyStateCharacters.style.display = 'none';
    if (this.els.charactersGrid) {
      this.els.charactersGrid.style.display = 'grid';
      this.els.charactersGrid.innerHTML = '';
      
      characters.forEach(char => {
        const card = document.createElement('div');
        card.className = 'character-card';
        card.innerHTML = `
          <div class="character-card__name">${char.name}</div>
          <div class="character-card__count">出场 ${char.count} 次</div>
          <div class="character-card__summary" style="font-size:12px; color:var(--color-text-secondary); margin-bottom:12px; line-height:1.5; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden;">
            ${char.summary || '暂无简介'}
          </div>
          <div class="character-card__tags">
            ${char.tags.map(t => `<span class="tag tag--blue">${t}</span>`).join('')}
          </div>
        `;
        card.addEventListener('click', () => this.showCharacterModal(char));
        this.els.charactersGrid.appendChild(card);
      });
    }
  }

  showCharacterModal(char) {
    if (!this.els.modalOverlay) return;
    this.els.modalName.textContent = char.name;
    this.els.modalStats.innerHTML = `
      <span class="stat-badge stat-badge--blue">出场 ${char.count} 次</span>
      <span class="stat-badge">${char.firstChapterTitle || ''}</span>
    `;
    this.els.modalTags.innerHTML = char.tags.map(t => `<span class="tag">${t}</span>`).join('');
    this.els.modalSummary.textContent = char.summary || '暂无摘要';
    this.els.modalRelated.innerHTML = (char.related || []).length > 0 
      ? char.related.map(r => `<li><span class="name">${r}</span></li>`).join('')
      : '<li style="color:var(--color-text-muted)">暂无</li>';
    this.els.modalChapters.innerHTML = (char.chapterAppearances || []).map(c => 
      `<span class="tag">第${c+1}章</span>`).join('');
    
    this.els.modalOverlay.classList.add('open');
  }

  closeCharacterModal() {
    if (this.els.modalOverlay) this.els.modalOverlay.classList.remove('open');
  }

  renderGraphView() {
    const relationships = this.analyzer.relationships || [];
    const characters = this.analyzer.getAllCharacters() || [];
    const families = this.analyzer.families || [];
    
    if (relationships.length === 0 && characters.length === 0) {
      if (this.els.emptyStateGraph) {
        this.els.emptyStateGraph.style.display = 'flex';
        this.els.emptyStateGraph.innerHTML = '<p class="empty-state__text" style="color:var(--color-text-muted);">大模型分析完成后即可查看关系图谱</p>';
      }
      return;
    }
    
    if (this.els.emptyStateGraph) this.els.emptyStateGraph.style.display = 'none';
    
    if (typeof renderGraph === 'function') {
      // Avoid re-rendering completely if already rendered (optimization)
      const graphContainer = document.getElementById('graph-container');
      if (graphContainer && graphContainer.innerHTML === '') {
        renderGraph(relationships, characters, families);
      } else if (graphContainer) {
        // Clear and re-render to update nodes if needed
        graphContainer.innerHTML = '';
        renderGraph(relationships, characters, families);
      }
    }
  }

  /**
   * UI 状态切换
   */
  showLoading() {
    if (this.els.emptyState) this.els.emptyState.style.display = 'none';
    if (this.els.viewReader) this.els.viewReader.style.display = 'none';
    if (this.els.loadingState) this.els.loadingState.style.display = 'flex';
  }

  updateLoadingText(text) {
    const loadingText = this.els.loadingState?.querySelector('.loading__text');
    if (loadingText) loadingText.textContent = text;
  }

  showReader() {
    this.switchView('reader');
    if (this.els.loadingState) this.els.loadingState.style.display = 'none';
  }

  showEmpty() {
    if (this.els.emptyState) this.els.emptyState.style.display = 'flex';
    if (this.els.loadingState) this.els.loadingState.style.display = 'none';
    if (this.els.viewReader) this.els.viewReader.style.display = 'none';
    if (this.els.viewCharacters) this.els.viewCharacters.style.display = 'none';
    if (this.els.viewGraph) this.els.viewGraph.style.display = 'none';
    if (this.els.pagination) this.els.pagination.style.display = 'none';
  }
}

// 启动
document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
