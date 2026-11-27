// Legal & compliance documents for retail jewellery advance purchase schemes
// Compliant with Companies Act 2013 (deposit acceptance rules exemption for advance goods < 365 days)
// and Digital Personal Data Protection Act (DPDPA), 2023.

export const SCHEME_TERMS = {
  title: 'Advance Purchase Scheme Terms & Conditions',
  version: '2026.1',
  effectiveDate: '2026-01-01',
  sections: [
    {
      heading: '1. Nature of the Scheme',
      content:
        'This arrangement is strictly an advance purchase contract for physical gold or silver bullion/jewellery between you (the Customer) and the registered retail jeweller. It is NOT a deposit, investment, collective investment scheme (CIS), portfolio management service, or digital gold. The platform does not hold customer funds and does not promise any return, interest, profit, or NAV appreciation.',
    },
    {
      heading: '2. Tenure and 365-Day Rule',
      content:
        'The scheme operates on a strict 11-month tenure. In strict compliance with Indian regulatory requirements under the Companies (Acceptance of Deposits) Rules, delivery of physical goods must occur, or unredeemed funds must be refunded, within 365 days from the date of advance. Redemption opens upon completion of Month 11.',
    },
    {
      heading: '3. Pricing and Allotment of Metal',
      content:
        'Advance payments are converted into equivalent metal weight (grams) up to four decimal places (0.0001 g) based on the applicable board rate at the time of payment confirmation. Gram allocations are floored to ensure exact accounting. Once a payment is confirmed, the transaction cannot be cancelled or reversed.',
    },
    {
      heading: '4. Redemption & Delivery',
      content:
        'From the start of Month 11 until Day 364, the customer may visit the showroom to redeem accumulated metal grams against certified hallmarked jewellery or coins. Making charges, wastage, and hallmarking charges apply as per showroom policy at the time of invoicing. GST is levied in accordance with applicable tax laws.',
    },
    {
      heading: '5. Mandatory Day-364 Refund',
      content:
        'Any unredeemed balance standing to the customer’s credit at Day 364 shall be refunded automatically to the customer’s verified source bank account. No cash refunds are permitted under any circumstances.',
    },
  ],
};

export const PRIVACY_POLICY = {
  title: 'Privacy Policy & DPDP Data Protection Notice',
  version: '2026.1',
  effectiveDate: '2026-01-01',
  sections: [
    {
      heading: '1. Information We Collect',
      content:
        'To facilitate compliance with statutory KYC guidelines (Prevention of Money Laundering Act / Income Tax Act), we collect your verified mobile number, full name, date of birth, personal Permanent Account Number (PAN), and transaction references.',
    },
    {
      heading: '2. Encryption & Storage Security',
      content:
        'Your PAN is encrypted at rest using military-grade AES-256-GCM authenticated encryption. Personal identifiers are never displayed in full and are masked across all operational dashboards.',
    },
    {
      heading: '3. Data Purpose & Sharing Limitations',
      content:
        'Data is processed solely for verifying customer eligibility (18+ years of age), anti-fraud checks, transaction attribution, and generating tax-compliant invoices upon redemption. We never sell, rent, or share personal data with third-party advertisers.',
    },
    {
      heading: '4. Customer Rights under DPDP Act 2023',
      content:
        'You have the right to access a summary of personal data held, request correction of inaccurate data, withdraw consent, and request deletion of personal records after the mandatory statutory retention period (e.g. tax and PMLA ledger records) has elapsed.',
    },
  ],
};

export const REFUND_POLICY = {
  title: 'Refund & Default Policy',
  version: '2026.1',
  effectiveDate: '2026-01-01',
  sections: [
    {
      heading: '1. In-Tenure Cancellation',
      content:
        'Individual instalments are irrevocable advance purchases of physical metal and cannot be cancelled or refunded mid-scheme.',
    },
    {
      heading: '2. Maturity & Default Handling',
      content:
        'If a customer is unable to visit the showroom or redeem goods prior to Day 364, the scheme will automatically close on Day 364, and the jeweller will remit the exact amount of rupee funds paid directly to the customer’s bank account via electronic transfer (NEFT/RTGS/UPI).',
    },
    {
      heading: '3. Non-Cash Remittance',
      content:
        'In strict compliance with statutory guidelines, all refunds are non-cash and must be returned exclusively to the customer’s verified bank account.',
    },
  ],
};
