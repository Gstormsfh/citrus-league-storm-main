import html from '../../public/privacy-policy.html?raw';
import { LegalDocument } from '@/components/LegalDocument';

export default function Privacy() {
  return <LegalDocument html={html} privacy />;
}
