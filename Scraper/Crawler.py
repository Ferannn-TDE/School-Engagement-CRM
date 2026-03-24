from abc import ABC, abstractmethod
import time
from selenium.webdriver.common.by import By
from rapidfuzz import fuzz
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.action_chains import ActionChains

class WebCrawler(ABC):
    def __init__(self):
        pass

    @abstractmethod
    def resolve_school(self, driver):
        pass

class NormalWebCrawler(WebCrawler):
    def __init__(self):
        WebCrawler.__init__(self)

    def similarity(self, a, b):
        a = a.strip().lower().strip()
        b = b.strip().lower().strip()
        return fuzz.ratio(a, b)

    
    def resolve_school(self, selenium, url, school_name, city):
        first = selenium.page_source
        # print(selenium.current_url)
        has_school_menu = False
        best = None
        high_score = 0
        i = 0
        school_menus = selenium.find_elements(By.XPATH, "//*[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'schools')]")
        for school_menu in school_menus:
            text = school_menu.get_attribute("innerText")
            
            if not text:
                continue
            if len(text.split()) != 1:
                    continue
            text = text.strip().lower()
            if text == "schools":
                best = school_menu
                break
            score = self.similarity(text, "schools")
            if score > high_score:
                high_score = score
                best = school_menu
        if best != None:
            has_school_menu = True
            try:
                actions = ActionChains(selenium)
                actions.move_to_element(best).click().perform()
                # print("clicked school menu AC")
            except:
                try:
                    selenium.execute_script("arguments[0].click();", best)
                    # print("clicked school menu JS")
                except:
                    print(best.get_attribute("innerText"))
                    print("School menu not clickable")

        if has_school_menu is False:
            best = None
            high_score = 0
            menus = selenium.find_elements(By.XPATH, "//*[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'menu')]")
            for menu in menus:
                text = menu.get_attribute("innerText")
                if not text:
                    continue
                text = text.strip().lower()
                if len(text.split()) != 1:
                    continue
                if text == "menu":
                    best = menu
                    break
                score = self.similarity(text, "menu")
                if score > high_score:
                    high_score = score
                    best = menu
            if best != None:
                try:
                    actions = ActionChains(selenium)
                    actions.move_to_element(best).click().perform()
                    # print("clicked menu AC")
                except:
                    try:
                        selenium.execute_script("arguments[0].click();", best)
                        # print("clicked menu JS")
                    except:
                        print(best.get_attribute("innerText"))
                        print("Regular menu not clickable")

        best = None
        high_score = 0
        if city in school_name:
            school_name.replace(city, "")
        school_split = school_name.split()
        first = school_split[1].lower()
        last = school_split[-1].lower()
        abbreviations = {"sr","jr", "jr/sr","sch", "chd", "int", "s", "hs"}
        if last in abbreviations:
            last = "school"
        if first in abbreviations:
            first = "high"


        schools = selenium.find_elements(By.XPATH, f"//a[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '{first}') and contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '{last}')]")
        for school in schools:
            text = school.get_attribute("innerText")
            if not text:
                continue
            text = text.strip().lower()
            if len(text.split()) > 7:
                continue

            if text == school_name:
                best = school
                break

            score = self.similarity(text, school_name)
            if score > high_score and score > 70:
                high_score = score
                best = school

            
        if best != None:
            # print(high_score)
            try:
                # print(best.get_attribute("innerText"))
                actions = ActionChains(selenium)
                actions.move_to_element(best).click().perform()
                if "/events/" not in selenium.current_url:
                    return selenium.current_url
                else:
                    return url
            except:
                    try:
                        selenium.execute_script("arguments[0].scrollIntoView(true);", best)
                        selenium.execute_script("arguments[0].click();", best)
                        if "/events/" not in selenium.current_url:
                            return selenium.current_url
                        else:
                            return url
                    except:
                        print(best.get_attribute("innerText"))
                        print("School link not clickable")
        else:
            return url
    

