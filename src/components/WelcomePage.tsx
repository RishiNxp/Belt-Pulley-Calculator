import ChromeSculpture from './ChromeSculpture';
import Icon from './Icon';

export default function WelcomePage({onStart,onOpenFile}:{onStart:()=>void;onOpenFile:()=>void}) {
  return <main className="pitch-front">
    <ChromeSculpture/>
    <header className="pitch-mast"><img src="./pitch-logo.png" alt=""/><strong>Pitch</strong></header>
    <section className="pitch-intro" aria-labelledby="welcome-title">
      <h1 id="welcome-title">Design your<br/>robotic systems.</h1>
      <p>Lay out gears, pulleys, and belts. Check how motion travels through your robot.</p>
      <div className="pitch-launch">
        <button className="welcome-primary" onClick={onStart}>Start a layout <Icon name="arrow-right" size={18}/></button>
        <button className="open-layout" onClick={onOpenFile}><Icon name="folder" size={16}/>Open saved layout</button>
      </div>
    </section>
  </main>;
}
