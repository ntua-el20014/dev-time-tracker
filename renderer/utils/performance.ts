// Pagination utility
export class PaginationManager<T> {
  private data: T[] = [];
  private pageSize: number;
  private currentPage = 1;
  private onPageChange: (pageData: T[], pageInfo: PageInfo) => void;

  constructor(
    pageSize: number,
    onPageChange: (pageData: T[], pageInfo: PageInfo) => void
  ) {
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

      // Auto-scroll to top after pagination change with smooth behavior
      setTimeout(() => {
        // Try multiple scrollable containers with smooth scrolling
        const summaryContent = document.getElementById("summaryContent");
        const tabSummary = document.getElementById("tab-summary");
        const container = document.querySelector(".container");
        const mainContent = document.querySelector(".main-content");
        const tabContent = document.querySelector(".tab-content.active");

        // First, try smooth scrolling for all potential containers
        [
          summaryContent,
          tabSummary,
          container,
          mainContent,
          tabContent,
          document.body,
          document.documentElement,
        ].forEach((element) => {
          if (element) {
            try {
              // Use smooth scrolling if available
              if (element.scrollTo) {
                element.scrollTo({ top: 0, behavior: "smooth" });
              } else {
                element.scrollTop = 0;
              }
            } catch (e) {
              // Ignore errors for elements that don't support scrolling
            }
          }
        });

        // Also try smooth scroll to summary content as primary method
        if (summaryContent) {
          try {
            summaryContent.scrollIntoView({
              behavior: "smooth",
              block: "start",
            });
          } catch (e) {
            // Fallback to instant scroll
            if (summaryContent.scrollIntoView) {
              summaryContent.scrollIntoView();
            }
          }
        }

        // Force window smooth scroll as final fallback
        try {
          window.scrollTo({ top: 0, behavior: "smooth" });
        } catch (e) {
          // Fallback to instant scroll
          try {
            window.scrollTo(0, 0);
          } catch (e2) {
            // Ignore if window.scrollTo is not available
          }
        }
      }, 50);
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
      endIndex,
    };

    this.onPageChange(pageData, pageInfo);
  }

  createPaginationControls(): HTMLElement {
    const controls = document.createElement("div");
    controls.className = "pagination-controls";

    const totalPages = this.getTotalPages();

    // Create Previous button
    const prevBtn = document.createElement("button");
    prevBtn.textContent = "Previous";
    prevBtn.disabled = this.currentPage === 1;
    prevBtn.addEventListener("click", () => {
      if (this.currentPage > 1) {
        this.goToPage(this.currentPage - 1);
      }
    });

    // Create page info span
    const pageInfo = document.createElement("span");
    pageInfo.textContent = `Page ${this.currentPage} of ${totalPages}`;

    // Create Next button
    const nextBtn = document.createElement("button");
    nextBtn.textContent = "Next";
    nextBtn.disabled = this.currentPage === totalPages;
    nextBtn.addEventListener("click", () => {
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

// Date-based pagination manager for by-date view
export class DateBasedPaginationManager {
  private data: any[] = [];
  private daysPerPage: number;
  private currentPage = 1;
  private onPageChange: (pageData: any[], pageInfo: PageInfo) => void;

  constructor(
    daysPerPage: number,
    onPageChange: (pageData: any[], pageInfo: PageInfo) => void
  ) {
    this.daysPerPage = daysPerPage;
    this.onPageChange = onPageChange;
  }

  setData(data: any[]) {
    this.data = data;
    this.currentPage = 1;
    this.renderCurrentPage();
  }

  private groupByDate(data: any[]): { [date: string]: any[] } {
    const grouped: { [date: string]: any[] } = {};
    data.forEach((row) => {
      if (!grouped[row.date]) grouped[row.date] = [];
      grouped[row.date].push(row);
    });
    return grouped;
  }

  getTotalPages(): number {
    const grouped = this.groupByDate(this.data);
    const uniqueDates = Object.keys(grouped);
    return Math.ceil(uniqueDates.length / this.daysPerPage);
  }

  goToPage(page: number) {
    if (page >= 1 && page <= this.getTotalPages()) {
      this.currentPage = page;
      this.renderCurrentPage();

      // Auto-scroll to top after pagination change with smooth behavior
      setTimeout(() => {
        // Try multiple scrollable containers with smooth scrolling
        const summaryContent = document.getElementById("summaryContent");
        const tabSummary = document.getElementById("tab-summary");
        const container = document.querySelector(".container");
        const mainContent = document.querySelector(".main-content");
        const tabContent = document.querySelector(".tab-content.active");

        // First, try smooth scrolling for all potential containers
        [
          summaryContent,
          tabSummary,
          container,
          mainContent,
          tabContent,
          document.body,
          document.documentElement,
        ].forEach((element) => {
          if (element) {
            try {
              // Use smooth scrolling if available
              if (element.scrollTo) {
                element.scrollTo({ top: 0, behavior: "smooth" });
              } else {
                element.scrollTop = 0;
              }
            } catch (e) {
              // Ignore errors for elements that don't support scrolling
            }
          }
        });

        // Also try smooth scroll to summary content as primary method
        if (summaryContent) {
          try {
            summaryContent.scrollIntoView({
              behavior: "smooth",
              block: "start",
            });
          } catch (e) {
            // Fallback to instant scroll
            if (summaryContent.scrollIntoView) {
              summaryContent.scrollIntoView();
            }
          }
        }

        // Force window smooth scroll as final fallback
        try {
          window.scrollTo({ top: 0, behavior: "smooth" });
        } catch (e) {
          // Fallback to instant scroll
          try {
            window.scrollTo(0, 0);
          } catch (e2) {
            // Ignore if window.scrollTo is not available
          }
        }
      }, 50);
    }
  }

  private renderCurrentPage() {
    const grouped = this.groupByDate(this.data);
    const uniqueDates = Object.keys(grouped).sort(
      (a, b) => new Date(b).getTime() - new Date(a).getTime()
    ); // Sort by date desc

    const startIndex = (this.currentPage - 1) * this.daysPerPage;
    const endIndex = Math.min(
      startIndex + this.daysPerPage,
      uniqueDates.length
    );
    const pageDates = uniqueDates.slice(startIndex, endIndex);

    // Get all data for the selected dates
    const pageData = pageDates.flatMap((date) => grouped[date]);

    const pageInfo: PageInfo = {
      currentPage: this.currentPage,
      totalPages: this.getTotalPages(),
      totalItems: this.data.length,
      itemsPerPage: pageData.length,
      startIndex,
      endIndex,
    };

    this.onPageChange(pageData, pageInfo);
  }

  // Get the date range for the current page
  getCurrentPageDateRange(): {
    startDay: number;
    endDay: number;
    totalDays: number;
  } {
    const grouped = this.groupByDate(this.data);
    const uniqueDates = Object.keys(grouped).sort(
      (a, b) => new Date(b).getTime() - new Date(a).getTime()
    );

    const startIndex = (this.currentPage - 1) * this.daysPerPage;
    const endIndex = Math.min(
      startIndex + this.daysPerPage,
      uniqueDates.length
    );

    return {
      startDay: startIndex + 1,
      endDay: endIndex,
      totalDays: uniqueDates.length,
    };
  }

  createPaginationControls(): HTMLElement {
    const controls = document.createElement("div");
    controls.className = "pagination-controls";

    const totalPages = this.getTotalPages();

    // Create Previous button
    const prevBtn = document.createElement("button");
    prevBtn.textContent = "Previous";
    prevBtn.disabled = this.currentPage === 1;
    prevBtn.addEventListener("click", () => {
      if (this.currentPage > 1) {
        this.goToPage(this.currentPage - 1);
      }
    });

    // Create page info span
    const pageInfo = document.createElement("span");
    pageInfo.textContent = `Page ${this.currentPage} of ${totalPages}`;

    // Create Next button
    const nextBtn = document.createElement("button");
    nextBtn.textContent = "Next";
    nextBtn.disabled = this.currentPage === totalPages;
    nextBtn.addEventListener("click", () => {
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
