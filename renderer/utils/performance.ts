// Pagination utility
export class PaginationManager<T> {
  private data: T[] = [];
  private pageSize: number;
  private currentPage = 1;
  private onPageChange: (pageData: T[], pageInfo: PageInfo) => void;
  
  constructor(pageSize: number, onPageChange: (pageData: T[], pageInfo: PageInfo) => void) {
    this.pageSize = pageSize;
    this.onPageChange = onPageChange;
  }
  
  setData(data: T[]) {
    this.data = data;
    this.currentPage = 1;
    this.renderCurrentPage();
  }
  
  getTotalPages(): number {
    return Math.ceil(this.data.length / this.pageSize);
  }
  
  goToPage(page: number) {
    if (page >= 1 && page <= this.getTotalPages()) {
      this.currentPage = page;
      this.renderCurrentPage();
    }
  }
  
  private renderCurrentPage() {
    const startIndex = (this.currentPage - 1) * this.pageSize;
    const endIndex = Math.min(startIndex + this.pageSize, this.data.length);
    const pageData = this.data.slice(startIndex, endIndex);
    
    const pageInfo: PageInfo = {
      currentPage: this.currentPage,
      totalPages: this.getTotalPages(),
      totalItems: this.data.length,
      itemsPerPage: this.pageSize,
      startIndex,
      endIndex
    };
    
    this.onPageChange(pageData, pageInfo);
  }
  
  createPaginationControls(): HTMLElement {
    const controls = document.createElement('div');
    controls.className = 'pagination-controls';
    
    const totalPages = this.getTotalPages();
    
    // Create Previous button
    const prevBtn = document.createElement('button');
    prevBtn.textContent = 'Previous';
    prevBtn.disabled = this.currentPage === 1;
    prevBtn.addEventListener('click', () => {
      if (this.currentPage > 1) {
        this.goToPage(this.currentPage - 1);
      }
    });
    
    // Create page info span
    const pageInfo = document.createElement('span');
    pageInfo.textContent = `Page ${this.currentPage} of ${totalPages}`;
    
    // Create Next button
    const nextBtn = document.createElement('button');
    nextBtn.textContent = 'Next';
    nextBtn.disabled = this.currentPage === totalPages;
    nextBtn.addEventListener('click', () => {
      if (this.currentPage < totalPages) {
        this.goToPage(this.currentPage + 1);
      }
    });
    
    // Append elements
    controls.appendChild(prevBtn);
    controls.appendChild(pageInfo);
    controls.appendChild(nextBtn);
    
    return controls;
  }
}

export interface PageInfo {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
  startIndex: number;
  endIndex: number;
}
