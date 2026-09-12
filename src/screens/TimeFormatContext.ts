import { createContext, useContext } from 'react';
import { TimeFormat } from '../domain/timeOfDay';

export const TimeFormatContext = createContext<TimeFormat>('12h');
export const useTimeFormat = (): TimeFormat => useContext(TimeFormatContext);
