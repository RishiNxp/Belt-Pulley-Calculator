import {expect,it} from 'vitest';
import {openBeltCenter, operatingEstimate} from './engineering';

it('fits equal pulleys and rejects a belt shorter than the non-overlapping minimum',()=>{
  expect(openBeltCenter(20/Math.PI,20/Math.PI,240)).toBeCloseTo(100,8);
  expect(openBeltCenter(20,10,100)).toBeNull();
});
it('uses magnitudes for wheel speed and output torque through a reversing reduction',()=>{
  const result=operatingEstimate(300,-0.5,1,90,100)!;
  expect(result.torque).toBeCloseTo(1.8);
  expect(result.speed).toBeCloseTo(Math.PI/4);
  expect(operatingEstimate(300,0,1,90,100)).toBeNull();
});
