// PrimeVue v4 unstyled-mode pass-through preset (Tailwind classes).
// Kept in its own module so both main.ts and vue-preview can load it.
import type { PrimeVuePTOptions } from 'primevue/config';

const preset: PrimeVuePTOptions = {
  datatable: {
    root: 'relative',
    tableContainer: 'overflow-auto rounded-lg border border-slate-200 bg-white',
    table: 'w-full border-separate border-spacing-0 text-sm',
    thead: 'bg-slate-100',
    tbody: 'bg-white',
    bodyRow: 'odd:bg-white even:bg-slate-50 hover:bg-brand-50',
    emptyMessageCell: 'px-4 py-6 text-center text-slate-400',
    column: {
      headerCell: 'px-4 py-2 text-left font-semibold text-slate-600 border-b border-slate-200',
      columnHeaderContent: 'flex items-center gap-2',
      columnTitle: 'font-semibold',
      bodyCell: 'px-4 py-2 border-b border-slate-100',
    },
  },
  dialog: {
    root: 'flex flex-col w-[28rem] max-h-[90%] rounded-xl bg-white shadow-2xl border border-slate-200',
    mask: 'fixed inset-0 flex items-center justify-center bg-black/40',
    header: 'flex items-center justify-between px-5 pt-5 pb-3',
    title: 'text-lg font-semibold text-slate-900',
    headerActions: 'flex items-center gap-2',
    pcCloseButton: {
      root: 'inline-flex items-center justify-center w-8 h-8 rounded-full text-slate-500 hover:bg-slate-100',
    },
    content: 'px-5 pb-2 overflow-y-auto',
    footer: 'flex justify-end gap-2 px-5 pt-2 pb-5',
  },
  button: {
    root: 'inline-flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium bg-brand-500 text-white hover:bg-brand-600 cursor-pointer',
    label: 'leading-none',
    icon: 'text-sm',
  },
  inputtext: {
    root: 'w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500',
  },
  tag: {
    root: 'inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium bg-slate-200 text-slate-700',
    icon: 'text-xs',
    label: '',
  },
};

export default preset;
