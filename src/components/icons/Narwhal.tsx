import { LucideProps } from 'lucide-react';

export const Narwhal = (props: LucideProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    {/* Body */}
    <path d="M18 13c0 3.8-3.2 7-8 7s-8-3.2-8-7c0-3.8 3.5-7 8-7 1.5 0 3 .5 4.5 1.5" />
    {/* Tail */}
    <path d="M2 13c-1.5 0-2 2.5-2 2.5s.5-3 2.5-3z" /> 
    <path d="M2 13c-1.5 0-2-2.5-2-2.5s.5 3 2.5 3z" />
    {/* Fin */}
    <path d="M12 13l-2 3" />
    {/* Horn */}
    <path d="M14 8L20 2" />
    <path d="M15.5 6.5l3-3" />
    {/* Eye */}
    <circle cx="13" cy="11" r="1" fill="currentColor" />
  </svg>
);

