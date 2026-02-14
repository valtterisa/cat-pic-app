export interface QuoteDoc {
  id: string;
  author: string | null;
  text: string;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date | null;
}

export interface QuoteLikeDoc {
  userId: string;
  quoteId: string;
  createdAt: Date;
}

export interface SavedQuoteDoc {
  userId: string;
  quoteId: string;
  createdAt: Date;
}
