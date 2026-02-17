import Navbar from "./sections/Navbar";
import Hero from "./sections/Hero";
import Benefits from "./sections/Benefits";
import HowItWorks from "./sections/HowItWorks";
import Modules from "./sections/Modules";
import SocialProof from "./sections/SocialProof";
import CtaForm from "./sections/CtaForm";
import Faq from "./sections/Faq";
import Footer from "./sections/Footer";

export default function Landing() {
  return (
    <div className="min-h-screen bg-background font-sans text-foreground selection:bg-primary/20">
      <Navbar />
      <main>
        <Hero />
        <SocialProof />
        <Benefits />
        <HowItWorks />
        <Modules />
        <CtaForm />
        <Faq />
      </main>
      <Footer />
    </div>
  );
}
